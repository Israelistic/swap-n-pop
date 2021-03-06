import assets from 'core/assets'
import game   from 'core/game'

export default class ComponentCharacter {
  private playfield_num     : number

  // this shouldn't be allowed to be public
  public sprite            : Phaser.Sprite

  private x                 : number
  private y                 : number
  private animations        : any
  private tick_counter      : number
  private frame_counter     : number
  private stopped           : boolean
  public  current_animation : string
  private last_animation    : string
  private name : string  
  /** 
   * A Sprite is added to the object and several animation objects
   * 
   * @param {Object} sprite Spritesheet with same dimensions as the other characters
   * @param {integer} x default 0
   * @param {integer} y default 0
   * @param {integer} pi playfield number
   */
  create(name, x = 0, y = 0, pi) {
    this.name = name
    this.playfield_num = pi
    // sprite creation
    this.sprite = game.add.sprite(x, y, name, 0)
    this.sprite.anchor.setTo(0.5)
    this.sprite.scale.set(2)
    this.sprite.smoothed = false
    this.x = x
    this.y = y

    if (pi == 1) {
      this.sprite.scale.x = -2
      this.x += 40
    } else {
      this.x -= 40
    }

    this.animations = new Map()
    this.add_animation(this.name, "stand")
    this.add_animation(this.name, "attack"  , "stand")
    this.add_animation(this.name, "attacked", "stand")
    this.add_animation(this.name, "lost", "", true)
    this.add_animation(this.name, "losing")
    this.add_animation(this.name, "charge")
    this.add_animation(this.name, "won", "", true)

    this.tick_counter = 0
    this.frame_counter = 0
    this.stopped = false
    this.current_animation = "stand"
    this.last_animation = this.current_animation
  }

  /**
   * Add an animation object with information to the Map object inside this character,
   * the defined name can then be called from the Map to return the animation object
   * 
   * @param {string} character key
   * @param {string} name simple name to be called by the animations map
   * @param {integer} hframes amount of horizontal frames to run through
   * @param {integer} offset amount of offset to start the hframes counting from
   * @param {String} return_to_animation the animation.name to return to after finishing the animation
   * @param {boolean} stop_animation if the animation cycle should in general stop
   */
  add_animation(key, name, return_to_animation = "", stop_animation = false) {
    const animation = {
      frames           : assets.spritesheets[key].animations[name],
      stop_animation   : stop_animation,
      parent_animation : return_to_animation
    }
    this.animations.set(name, animation)
  }

  /**
   * Runs through the current defined Animiation via its animation object,
   * Once the Animation is changed the Frame Counting will be reset,
   * If parent_animation is defined the Animation will auto switch to the defined parent
   * in the End of the current_animation
   * Once this.stopped is set it wont get auto reset!
   */
  play_animation() {
    let animation = this.animations.get(this.current_animation);
    // if no animation in map was found
    if (animation !== undefined) {
      // resets frame counter once animations change! animations would look cut up without this
      if (this.last_animation !== this.current_animation) {
        this.frame_counter = 0;
        this.last_animation = this.current_animation
      }
      let animation_size = animation.frames.length
      if (animation_size > 0) {
        if (!this.stopped && this.tick_counter % 5 === 0) {
          this.sprite.frame = animation.frames[this.frame_counter++]
          // loop
          if (this.frame_counter === animation_size) {
            this.frame_counter = 0;
            this.stopped = animation.stop_animation

            if (animation.parent_animation !== "")
              this.current_animation = animation.parent_animation
          }
          this.tick_counter = 0;    // so tick_counter never exceeds integer size
        }
        this.tick_counter++
      }
    }
  }

  /**
   * Snapshot getter for networking, if a package is lost the animation
   * will jump to the correct data back
   *  
   * @returns all important variables of the object 
   * */
  get snap() {
    return [
      this.tick_counter,
      this.frame_counter,
      this.stopped,
      this.current_animation,
      this.last_animation,
    ]
  }

  /**
   * All important variables are set to the data sent in snapshots once a 
   * package was confirmed to be lost
   * 
   * @param {Array} data information that was sent through this.snap
   */
  load(data) {
    this.tick_counter      = data[0]
    this.frame_counter     = data[1]
    this.stopped           = data[2]
    this.current_animation = data[3]
    this.last_animation    = data[4]
  }

  /** tick down the animation frames */
  update() {
    this.play_animation()
  }

  /** update the position and render all animations */
  render() {
    this.sprite.x = this.x
    this.sprite.y = this.y
  }
}
