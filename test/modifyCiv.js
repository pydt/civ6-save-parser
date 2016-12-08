'use strict';

const fs = require('fs');
const expect = require('chai').expect;
const civ6 = require('../index.js');

describe('Modify Cathy Save', function() {
  let buffer = new Buffer(fs.readFileSync('test/saves/CATHERINE DE MEDICI 1 4000 BC.Civ6Save'));
  const parsed = civ6.parse(buffer).parsed;

  it('should be able to change a player name', () => {
    buffer = civ6.modifyCiv(buffer, parsed.CIVS[0], { PLAYER_NAME: 'Mike Rosack' });
    //fs.writeFileSync('test/saves/modified.Civ6Save', buffer);

    const reparse = civ6.parse(buffer).parsed;

    expect(reparse.CIVS[0].data.PLAYER_NAME.data).to.equal('Mike Rosack');
  });

  it('should be able to change a human player to AI', () => {
    buffer = civ6.modifyCiv(buffer, parsed.CIVS[0], { ACTOR_AI_HUMAN: 1 });
    //fs.writeFileSync('test/saves/modified.Civ6Save', buffer);

    const reparse = civ6.parse(buffer).parsed;

    expect(reparse.CIVS[0].data.ACTOR_AI_HUMAN.data).to.equal(1);
  });
});