// 測速方向、路線投影、Google 路線轉換
const assert = require('assert');
const C = require('./core.js');
const d = (t) => C.camDir(t);
assert.strictEqual(d('北向南').deg, 180); assert.strictEqual(d('南往北').deg, 0);
assert.strictEqual(d('東往西').deg, 270); assert.strictEqual(d('西往東').deg, 90);
assert.ok(d('南北雙向').both && d('南北雙向').deg == null);
assert.strictEqual(d('北上').deg, 0); assert.strictEqual(d('南下').deg, 180);
assert.strictEqual(d('deg:45').deg, 45); assert.strictEqual(d('往三重').deg, null);
const co = [[121.517, 25.0478], [121.52, 25.0478], [121.52, 25.044]];
const pr = C.projectOnLine([121.52, 25.0465], co);
assert.ok(pr.d < 1 && pr.i === 1 && Math.abs(pr.s - 447) < 3);
const q = C.offsetPt([121.5, 25], 90, 9);
assert.ok(Math.abs(C.dist([121.5, 25], q) - 9) < 0.1 && Math.abs(C.bearing([121.5, 25], q) - 90) < 0.5);
const g = C.fromGoogleRoute({ path: [{ lat: 25, lng: 121 }, { lat: 25.01, lng: 121 }], distanceMeters: 1100, durationMillis: 120000, localizedValues: { transitFare: '15 元' },
  legs: [{ steps: [{ navigationInstruction: { maneuver: 'TURN_SLIGHT_LEFT', instructions: '靠左' }, path: [{ lat: 25, lng: 121 }], distanceMeters: 1100, durationMillis: 120000 }] }] });
assert.strictEqual(g.steps[0].maneuver.type, 'depart'); assert.strictEqual(g.steps[g.steps.length - 1].maneuver.type, 'arrive');
assert.strictEqual(g.fare, '15 元'); assert.strictEqual(C.googleManeuver('UTURN_LEFT').modifier, 'uturn');
console.log('測速方向＋投影＋Google 路線轉換測試通過');
