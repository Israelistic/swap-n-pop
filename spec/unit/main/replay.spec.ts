import * as fs     from 'fs'
import * as path   from 'path'
import Replay from 'common/replay'

const app = {
  getPath: sinon.stub()
}
app.getPath.returns('/tmp')

describe('Replay' ,function(){
  describe('#save(name,inputs)' ,function(){
    var filename = null;
    beforeAll(function(done) {
      const inputs = [
        [0x00,0x00,0x20,0x20],
        [0x01,0x00,0x10,0x00]
      ]
      Replay.save('replay_spec','seed',inputs,function(err,data){
        if (err) { done(err) }
        filename = data
        done()
      })
    });

    it('should return filename', function(){
      filename.should.equal(path.join('/tmp','replays','replay_spec.replay'))
    })

    it('file should exist', function(done){
      fs.access(filename,fs.constants.F_OK,function(err){
        err ? done(err) : done()
      })
    })

    it('should saved date in octets', function(done){
      fs.readFile(filename, function(err,data){
        if (err) { done(err) }
        expect(data).eql(Buffer.from([
           0x04 // length of seed
          ,0x01 // length of integer for player 0 frame_count
          ,0x01 // length of integer for player 1 frame_count
          ,0x73 // seed start
          ,0x65 // |
          ,0x65 // |
          ,0x64 // seed end
          ,0x04 // integer frame_count for player 0
          ,0x04 // integer frame_count for player 1
          ,0x00,0x00,0x20,0x20  // input per frame for player 0
          ,0x01,0x00,0x10,0x00  // input per frame for player 1
        ]))
        done()
      })
    })
    afterAll(function() {
      fs.unlink(filename,function(){})
    });
  })

  describe('#load(name)' ,function(){
    var filename = null;
    const name   = 'replay_spec'
    const inputs = [
      [0x00,0x00,0x20,0x20],
      [0x01,0x00,0x10,0x00]
    ]
    beforeAll(function(done) {
      Replay.save(name,'seed',inputs,function(err,data){filename = data;done()})
    })

    it('should return seed and inputs', function(done){
      Replay.load(name,function(err,data){
        if (err) { done(err) }
        data.seed.should.eql('seed')
        data.inputs.should.eql(inputs)
        done()
      })
    })
    afterAll(function() {
      fs.unlink(filename,function(){})
    });
  })
})
