import game                     from 'core/game'
import CoreGarbage              from 'core/garbage'
import CoreStage                from 'core/stage'

import ComponentPlayfieldCountdown from 'components/playfield_countdown'
import ComponentPlayfieldCursor    from 'components/playfield_cursor'
import ComponentPlayfieldWall      from 'components/playfield_wall'
import ComponentScore              from 'components/score'
import ComponentPanel              from 'components/panel'
import ComponentCharacter          from 'components/character'
import ComponentAi                 from 'components/ai'
import ComponentGarbagePreview     from 'components/garbage_preview'

import { i2xy, xy2i } from 'core/filters';

import {
  ROWS_INV,
  ROWS_VIS,
  ROWS,
  COLS,
  PANELS,
  UNIT,
  STATIC,
  TIME_PUSH,
  TIME_POP,
  TIME_FLASH,
  TIME_FACE,
  STOPTIME,
  GARBAGE_SHAKE,
  STARTING,
  RUNNING,
  PAUSE,
  GAMEOVER,
  CLEAR,
  SCORE_COMBO,
  SCORE_CHAIN,
  RAISE_BLOCKED_TIME,
  TIME_RAISE
} from 'common/data';
import PanelGenerator from 'core/panel_generator';

export default class Playfield {
  get [Symbol.toStringTag](){ return 'Playfield' }

  public  pi                : number  // player number, used to detect input
  private rows              : number
  private cols              : number

  public  stage           : any //CoreStage
  public  garbage         : CoreGarbage
  public  garbage_preview : ComponentGarbagePreview
  public  countdown       : ComponentPlayfieldCountdown
  public  cursor          : ComponentPlayfieldCursor
  private wall            : ComponentPlayfieldWall
  private score_lbl       : ComponentScore
  private ai              : ComponentAi
  public  character       : ComponentCharacter
  public panel_generator  : PanelGenerator
  private bg : Phaser.Sprite

  public  should_push      : boolean
  private height : number
  private width : number
  public x : number
  public y : number
  public layer_block : Phaser.Group
  public layer_cursor : Phaser.Group

  public swap_counter : number

  /* array of panels grouped by number based on tick */
  public  clearing_garbage  : Array<number>
  private score             : number
  private has_ai            : boolean
  private land              : boolean

  public _stack    : Array<ComponentPanel>
  public stoptime : number
  public shake    : number
  public counter  : number
  public pushing  : boolean
  public push_counter  : number
  public garbage_landing : boolean

  public level : number 

  // combo and chaining variables
  public clear_queue : Array<ComponentPanel> // holds all blocks currently clearing
  public chain : number // latest chain detected, gets set to 1 which means a basic combo
  public last_chain : number
  public combo_counter : number // latest combo detected

  // raise variables
  public signal_raise : boolean
  public any_clears : boolean
  public any_top_panels : boolean
  public smooth_raise : boolean
  public raise_blocked_counter : number
  public offset_counter : number
  public raise_generated_panels : String // saves the latest generated blocks in string format

  constructor(pi) {
    if (pi !== 0 && pi !== 1){
      throw new Error("player_number present and must be 0 or 1")
    }

    this.pi = pi
    this.garbage         = new CoreGarbage()
    this.garbage_preview = new ComponentGarbagePreview()
    this.countdown       = new ComponentPlayfieldCountdown()
    this.cursor          = new ComponentPlayfieldCursor()
    this.wall            = new ComponentPlayfieldWall()
    this.score_lbl       = new ComponentScore()
    this.ai              = new ComponentAi()
    this.character       = new ComponentCharacter()
    this.panel_generator = new PanelGenerator()
  }

  get stack() {
    return this._stack
  }

  stack_i(i) {
    return this._stack[i]
  }

  stack_xy(x: number, y: number) {
    return this._stack[xy2i(x,y)]
  }

  get snap() {
    const snap_cursor = this.cursor.snap
    const snap_stack  = []
    for (let panel of this.stack){
      snap_stack.push(panel.snap)
    }
    return [
      this.push_counter,
      snap_cursor,
      snap_stack,
      this.pushing,
      this.character.snap,
      this.garbage.snap
    ]
  }

  load(snapshot) {
    this.push_counter = snapshot[0]
    this.cursor.load(   snapshot[1])
    for (let i = 0; i < this.stack_len; i++) {
      this.stack_i(i).load(snapshot[2][i])
    }
    this.pushing = snapshot[3]
    this.character.load(snapshot[4])
    this.garbage.load(snapshot[5])
  }

  create(stage,opts) {
    if (stage === null) {
      throw new Error("must pass stage")
    }
    if (opts           === null ||
        opts.x         === null ||
        opts.y         === null ||
        opts.countdown === null ||
        opts.panel     === null){
      throw new Error("must pass at least x,y,countdown and panels")
    }

    this.stage       = stage
    this.panel_generator.create(stage.rng)
    this.should_push = opts.push || false

    this.height = (ROWS+1) * UNIT
    this.width  = COLS     * UNIT

    this.x = opts.x
    this.y = opts.y

    let pos = this.pi
    if (this.stage.online && game.server.pos === 1) {
      pos = (this.pi === 0) ? 1 : 0
    }
    this.bg = game.add.sprite(this.x,this.y,`char_0${pos}`)

    this.layer_block  = game.add.group()

    this.create_stack(opts.panels)

    if (this.stage.flag_garbage === true){
      this.garbage.create(this.stage,this.pi)
      this.garbage_preview.create(this,this.x,0)
    }

    this.reset()
    //this.score_lbl.create()
    // for mode_puzzle, couting all swaps
  }

  get clear(){
    let clear = false
    for (let p of this.stack){
      if (p.fsm.state === CLEAR) {
        clear = true
        break
      }
    }
    return clear
  }

  create_after() {
    this.layer_cursor = game.add.group()
    this.layer_cursor.x = this.x
    this.layer_cursor.y = this.y

    this.countdown.create(this)
    this.cursor.create(this)
    if (this.has_ai) { this.ai.create(this, this.cursor) }
    this.wall.create(this,this.x,this.y)

    let pos = null
    if (this.stage.online && game.server.pos === 1) {
      pos = (this.pi === 0) ? 'kindle' : 'zephyr'
    } else {
      pos = (this.pi === 0) ? 'zephyr' : 'kindle'
    }
    this.character.create(
      pos,
      game.world.centerX,
      game.world.centerY - 100,
      this.pi
    );
  }

  create_stack(data) {
    this._stack = []
    this.create_panels()
    this.fill_panels(data)
    this.create_neighbors()
  }

  // sets all neighbors for each block
  // this is only necessary to be called once! panels never "move" they stay in the same place
  create_neighbors() {
    for (let i = 0; i < PANELS; i++) {
      var b = this.stack[i]

      b.neighbors["right"] = b.x < COLS - 1 ? this.stack[i + 1] : undefined
      b.neighbors["left"] = b.x > 0 ? this.stack[i - 1] : undefined
      b.neighbors["up"] = b.y > 0 ? this.stack[i - COLS] : undefined
      b.neighbors["down"] = b.y < ROWS - 1 ? this.stack[i + COLS] : undefined

      b.neighbors["right2"] = b.x < COLS - 2 ? this.stack[i + 2] : undefined
      b.neighbors["left2"] = b.x > 1 ? this.stack[i - 2] : undefined
      b.neighbors["up2"] = b.y > 1 ? this.stack[i - COLS * 2]: undefined
      b.neighbors["down2"] = b.y < ROWS - 2 ? this.stack[i + COLS * 2] : undefined
    }
  }

  get stack_len() {
    return this._stack.length
  }

  get stack_size() {
    return this.should_push ? this.stack_len-COLS : this.stack_len
  }

  game_over() {
    this.stage.state = GAMEOVER
    this.push_counter = 0
  }

  create_panels(){
    const rows = (ROWS + (this.should_push === true ? 1 : 0 ))
    const size = COLS * rows
    this._stack = new Array().fill(null)

    for (let i = 0; i < size; i++){
      const [x,y] = Array.from(i2xy(i))
      this._stack[i] = new ComponentPanel()
      this.stack_i(i).create(this, x, y)
    }

    this.stack.forEach(p => p.create_after())
  }

  /**
   * Sets the Stack Panels to data given by the parameter.
   * Also if a push call was made it also sets the bottom row to unique - not comboable
   *
   * @param {Array} data the panel.kind data from 0 to ~10 or nulls = empty
   */
  public fill_panels(data) {
    this.stack.forEach((panel, i) => { 
      panel.reset()
      panel.set_kind(data[i])
    });

    if (this.should_push)
      for (let i = PANELS; i < PANELS+COLS; i++)
        this.stack_i(i).set_kind('unique')
  }

  update_stack() {
    for (let i = 0; i < this.stack_len; i++) {
      this.stack_i((this.stack_len-1)-i).update()
    }
  }

  /**
   * Resets this playfields stack to the new given data
   * Resets the swap_counter - puzzle mode
   *
   * @param {Array} new_Panels the panels the stack should reset to
   * @param {integer} new_counter_size size that the swap_counter should be set to
   */
  reset_stack(new_Panels, new_counter_size = 0) {
    this.stack.forEach((panel) => { panel.soft_reset() })
    this.swap_counter = new_counter_size
    this.fill_panels(new_Panels)
  }

  public reset(){
    if (this.stage.flag_garbage === true) {
      this.clearing_garbage = []
    }
    this.score        = 0
    this.push_counter = TIME_PUSH
    this.stoptime     = STOPTIME
    this.pushing      = false
    this.swap_counter = 0
    this.garbage_landing = false
    this.cursor.reset('vs')
    this.layer_block.x  = this.x
    this.layer_block.y  = this.y - (ROWS_INV*UNIT)

    // new
    this.level = 0
    this.chain = 1
    this.last_chain = 1
    this.clear_queue = new Array()
    this.combo_counter = 0

    // raise values
    this.signal_raise = false
    this.any_clears = false
    this.any_top_panels = false
    this.smooth_raise = false
    this.raise_blocked_counter = 0
    this.offset_counter = 0
    this.raise_generated_panels = "" // saves the latest generated blocks in string format
  }

  /**
   * checks if the stack has only empty panels
   * @returns true when the whole stack consists of empty block
   */
  stack_is_empty() {
    for (var i = 0; i < PANELS; i++)
      if (!this.stack_i(i).empty)
        return false;
    return true;
  }

  // returns true if any block is chainable
  any_chainable_exists() {
    for (let panel of this.clear_queue)
      if (panel.chainable)
        return true
			
	  return false
  }

  // looks at all the "clears" found this frame 
  // merges all together - looks if any neighboring blocks have the same colours
  // then sets their state accordingly
  check_combo_frame() {
    for (let panel of this.stack) 
      for (let clear_panel of panel.check_clear())
        if (!this.clear_queue.includes(clear_panel))
          this.clear_queue.push(clear_panel)

    if (this.clear_queue.length !== 0) {
      this.combo_counter = 0

      // gather all times
      let flash = TIME_FLASH[this.level]
      let face = TIME_FACE[this.level]
      let pop = TIME_POP[this.level]

      let all_time = flash + face + pop * this.clear_queue.length

      // check wether any of the blocks were chainable 
      let had_chainable = this.any_chainable_exists()
      
      // increase the chain further
      if (had_chainable) {
        this.chain += 1
        //this.clear_queue[0].popup.spawn(flash, chain, "chain")
        this.last_chain = Math.max(this.chain, this.last_chain)
      }
      // otherwhise reset it
      else
        this.chain = 1

      for (let panel of this.clear_queue) {
        let set_time = flash + face + pop * this.combo_counter
        panel.clear_time = set_time 
        this.combo_counter += 1
        
        // sets the time a block takes to clear from relative to its position
        panel.counter = all_time
        panel.clear_start_counter = all_time
        panel.fsm.change_state(CLEAR)
      }
    }

    this.clear_queue = new Array<ComponentPanel>()
  }

  /**
   * Calls the swap Method through the given parameters on the internal stack.
   * Only able to swap if both Panels are swappable.
   * A swap_counter goes up that counts all swaps (no swaps done when both panels are empty).
   *
   * @param {integer} x xpos to be accessed in the stack - 2D Array whise
   * @param {integer} y ypos to be accessed in the stack - 2D Array whise
   */
  swap(x,y) {
    let panel_left   = this.stack_xy(x, y);
    let panel_right  = this.stack_xy(x + 1, y);

    if (panel_left.swap())
      if (!panel_left.empty && !panel_right.empty) {
        this.swap_counter++;
        return true;
      }
  }

  danger(within) {
    const offset = COLS*(within+ROWS_INV);
    const cols   = [];
    for (let i = 0; i < COLS; i++){
      if (this.stack_i(offset+i).stable){
        cols.push(i)
      }
    }
    if (cols.length > 0) { return cols; } else { return false; }
  }

  add_score(value) {
    this.score += value
  }

  score_combo(combo) {
    this.score += SCORE_COMBO[Math.min(combo - 1, SCORE_COMBO.length - 1)]
  }

  score_chain(chain) {
    this.score += SCORE_CHAIN[Math.min(chain - 1, SCORE_CHAIN.length - 1)]
  }
  
  update_garbage_clearing(){
    if (this.clearing_garbage.length > 0){
      for (let panel of this.stack){
        panel.garbage.popping()
      }
    }
  }

  // visualizes an offset of the controller and all panels,
  // each time they cross their size theyll get "teleported" to the new position in the grid
  // since a visibility issue resolves out of this you have to disable offsets on 1 frame
  visual_offset() : void {
    if (this.signal_raise)
      this.smooth_raise = true
    
    if (this.any_clears || this.any_top_panels) {
      this.smooth_raise = false // deletes all smooth_raise signals
      return
    }

    if (this.raise_blocked_counter > 0) {
      this.raise_blocked_counter -= 1
      this.smooth_raise = false // deletes all smooth_raise signals
      return
    }

    if (this.offset_counter < -UNIT) {
      this.offset_counter = 0
      this.set_visual_offsets(0)
      this.smooth_raise = false
      this.raise_generated_panels = this.push_upwards()
      this.raise_blocked_counter = RAISE_BLOCKED_TIME
    }
    else {
      this.offset_counter -= this.smooth_raise ? 4 : TIME_RAISE[this.level]
      this.set_visual_offsets(this.offset_counter)
    }
  }

  // sets y offsets of the panels and the controller to the value put in
  set_visual_offsets(value: number) : void {
    for (let panel of this.stack)
      panel.offset.y = value
    
    this.cursor.y_offset = value
  }

  // pushes all panels up in this platyfield and randomizes the bottom
  // returns all panels spawned as a string
  push_upwards() : String {
    for (let panel of this.stack) 
      if (panel.neighbors["up"] !== undefined)
        panel.swap_properties("up")
    
    // TODO: dont havy any convert block data to string yet!
    //let pushed_panels = ""
    let created_kinds = this.panel_generator.create_rows()
    for (let i = PANELS - COLS; i < PANELS; i++) {
      let coords = i2xy(i)
      let panel = this.stack_xy(coords[0], coords[1])
      panel.kind = created_kinds.pop() // TODO array has no pop_front()
      //pushed_panels += str(panel.save_in_replay_format())
    }
    
    if (this.cursor.y > ROWS_VIS) 
      this.cursor.y -= 1
  
    return "" // pushed_panels
  }

  // returns true if no blocks are currently clearing, allows pushing to happen to inputs
  check_panels_clearing() : boolean {
    // check if any blocks are clearing, if so then stop movement
    for (let panel of this.stack)
      if (panel.fsm.state == "CLEAR")// || panel.fsm.state == "GARBAGE_CLEAR":
        return true

    return false
  }

  // checks if any blocks are at the top or not, doesnt check for garbage tho
  check_panels_at_top() : boolean {
    for (let x = 0; x < COLS; x++) {
      let p = this.stack_xy(x, ROWS_VIS)

      // check for a non garbage block that is idle
      // and check for garbage head with idle
      if (p.kind != null && p.fsm.state === STATIC) // && !p.is_garbage || p.garbage_head && p.fsm.state === STATIC)
        return true
    }

    return false
  }

  update_stoptime() {
    if (this.stage.state !== RUNNING){ return }
    if (this.danger(0) && this.push_counter <= 0) {
      this.stoptime--
      this.character.current_animation = "losing"
      if (this.stoptime <= 0){
        this.stage.game_over(this.pi)
      }
    } else {
      this.stoptime = STOPTIME
    }
  }

  update() {
    switch (this.stage.state) {
      case STARTING:
        this.cursor.update()
        break;

      case RUNNING:
        this.cursor.update()
        this.character.update()
        this.update_stoptime()

        if (this.counter > 0) { this.counter-- }
        
        // global checks so you dont have to always call the methods
        this.any_clears = this.check_panels_clearing()
        this.any_top_panels = this.check_panels_at_top()

        this.visual_offset()
        this.clearing_garbage = []

        this.update_stack()
        if (this.has_ai) { this.ai.update() }
        this.check_combo_frame()
        
        //this.combo = cnc[0]
        //this.chain = cnc[1]
        //if (cnc[1] > 1)
          //this.character.current_animation = "charge"

        if (this.stage.flag_garbage === true) {
          this.update_garbage_clearing()
          //this.garbage.update(cnc[0],cnc[1])
          this.garbage_preview.update()
        }

        if (this.garbage_landing === true){
          game.sounds.land()
          this.garbage_landing = false
        }
        if (this.land === true) {
          game.sounds.land()
          this.land = false
        }
        break;

      case PAUSE:
        break;

      case GAMEOVER:
        this.character.update()
        break;
    }
  }

  render() {
    this.countdown.render()
    this.cursor.render()
    this.wall.render()
    this.stack.forEach(p => p.render())
    this.character.render()
    if (this.stage.flag_garbage === true)
      this.garbage_preview.render()

    let shake = 0
    if (this.shake >= 0 && this.counter > 0) {
      const shake_i  = GARBAGE_SHAKE[this.shake].length-this.counter
      shake = GARBAGE_SHAKE[shake][shake_i]
    }

    const y = this.y - (ROWS_INV*UNIT)
    if (this.should_push) {
      const lift = (this.push_counter / TIME_PUSH) * UNIT
      this.layer_block.y  = y + lift + shake
      this.layer_cursor.y = y + lift + shake
    } else {
      this.layer_block.y  = y + shake
      this.layer_cursor.y = y + shake
    }
  }

  shutdown() {
    return this.cursor.shutdown()
  }
}
