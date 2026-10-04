const assert = require('assert');
const C = require('./core.js');
// 距離：台北車站→101 手算約 5.03 公里
const d = C.dist([121.5170, 25.0478], [121.5645, 25.0340]);
assert.ok(d > 4950 && d < 5100, 'dist ' + d);
// 點到線距離
const line = [[121.50, 25.00], [121.51, 25.00]];
const off = C.distToLine([121.505, 25.0009], line);
assert.ok(off > 90 && off < 110, 'off ' + off);
assert.ok(C.distToLine([121.505, 25.0], line) < 1);
// 沿線插值
const a = C.alongLine(line, 500);
assert.ok(Math.abs(C.dist(line[0], a.p) - 500) < 1 && !a.done);
assert.ok(Math.abs(a.bearing - 90) < 0.5, 'bearing ' + a.bearing);
assert.ok(C.alongLine(line, 99999).done);
// 格式
assert.strictEqual(C.fmtDist(347), '350 公尺');
assert.strictEqual(C.fmtDist(3), '10 公尺');
assert.strictEqual(C.fmtDist(1234), '1.2 公里');
assert.strictEqual(C.fmtDist(23456), '23 公里');
assert.strictEqual(C.fmtDur(90), '2 分鐘');
assert.strictEqual(C.fmtDur(3900), '1 小時 5 分');
// 轉彎文字
const t = (type, modifier, name, exit) => C.maneuverText({ maneuver: { type, modifier, exit }, name });
assert.strictEqual(t('turn', 'left', '忠孝東路').text, '左轉，進入忠孝東路');
assert.strictEqual(t('turn', 'slight right', '').text, '靠右');
assert.strictEqual(t('depart', 'right', '中山北路').text, '沿中山北路出發');
assert.strictEqual(t('arrive', 'left', 'x').icon, 'arrive');
assert.strictEqual(t('roundabout', 'right', '', 2).text, '進入圓環，從第 2 個出口離開');
assert.strictEqual(t('fork', 'slight left', '國道1號').text, '於岔路靠左，進入國道1號');
assert.strictEqual(t('end of road', 'right', '').text, '路底右轉');
assert.strictEqual(t('turn', 'uturn', '').icon, 'uturn');
// YouTube
assert.deepStrictEqual(C.parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), { videoId: 'dQw4w9WgXcQ', listId: undefined });
assert.deepStrictEqual(C.parseYouTube('https://youtu.be/dQw4w9WgXcQ?si=abc'), { videoId: 'dQw4w9WgXcQ', listId: undefined });
assert.strictEqual(C.parseYouTube('https://m.youtube.com/shorts/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
assert.strictEqual(C.parseYouTube('youtube.com/live/dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
assert.strictEqual(C.parseYouTube('https://music.youtube.com/playlist?list=PL123').listId, 'PL123');
assert.strictEqual(C.parseYouTube('dQw4w9WgXcQ').videoId, 'dQw4w9WgXcQ');
assert.strictEqual(C.parseYouTube('https://example.com/watch?v=dQw4w9WgXcQ'), null);
assert.strictEqual(C.parseYouTube('隨便打'), null);
// 天氣
assert.strictEqual(C.weatherInfo(0).text, '晴');
assert.strictEqual(C.weatherInfo(63).icon, 'rain');
assert.strictEqual(C.weatherInfo(95).text, '雷雨');
console.log('新功能測試通過');
