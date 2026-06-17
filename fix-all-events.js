const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Current known indices (from analysis)
const canvasIdx = 2;
const newTurretPanelIdx = 44;

// 1. Fix Btn_BuildTurret ClickEvent [52]: change handler to buildBaseTurret
console.log('1. Btn_BuildTurret ClickEvent[52]: onBuildButtonClick → buildBaseTurret');
data[52].handler = 'buildBaseTurret';

// 2. Clear Btn_OpenUpgrade Button [69] clickEvents (let BuildPanelUI handle it)
console.log('2. Clear Btn_OpenUpgrade clickEvents (was showPanel on TurretBuildPanelUI)');
data[69].clickEvents = [];

// 3. Btn_ClosePanel ClickEvent [60]: already correct (target NewTurretPanel, handler active)
console.log('3. Btn_ClosePanel already correct (deactivate NewTurretPanel)');

// 4. Btn_OpenTurret Button [111]: add ClickEvent to show NewTurretPanel via TurretBuildPanelUI
// Create new ClickEvent at the end of the array
const newClickEventIdx = data.length;
const newClickEvent = {
    "__type__": "cc.ClickEvent",
    "target": { "__id__": canvasIdx },
    "component": "TurretBuildPanelUI",
    "_componentId": "e52e8hsdLJJfaJp50sJqkPb",
    "handler": "showPanel",
    "customEventData": ""
};
data.push(newClickEvent);
data[111].clickEvents = [{ "__id__": newClickEventIdx }];
console.log('4. Btn_OpenTurret → showPanel (TurretBuildPanelUI on Canvas)');
console.log('   New ClickEvent added at index:', newClickEventIdx);

// 5. Remove stale TurretBuildPanelUI [104] from old TurretPanel's _components
// Old TurretPanel is at index 94
const oldTurretPanel = data[94];
const oldComponents = oldTurretPanel._components;
oldTurretPanel._components = oldComponents.filter(c => c.__id__ !== 104);
console.log('5. Removed stale TurretBuildPanelUI from old TurretPanel _components');

fs.writeFileSync('d:/COCOS项目/NewProject_2/assets/1.scene', JSON.stringify(data, null, 2));
console.log('\nWritten.');

// Verify
const verify = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));
console.log('Valid JSON, length:', verify.length);
const bad = [];
function w(o) { if (Array.isArray(o)) o.forEach(w); else if (o && typeof o==='object') { if (o.__id__>=0 && (o.__id__>=verify.length||o.__id__<0)) bad.push(o.__id__); for (const k in o) w(o[k]); } }
w(verify);
console.log('Out-of-bounds __id__:', bad.length===0?'None':bad);

// Show final clickEvents
console.log('\n=== FINAL STATE ===');
for (let i = 0; i < verify.length; i++) {
    if (verify[i].__type__ === 'cc.Button') {
        const nodeName = verify[verify[i].node.__id__]._name;
        const events = verify[i].clickEvents;
        if (events && events.length > 0) {
            events.forEach(e => {
                const ceIdx = e.__id__;
                const ce = verify[ceIdx];
                console.log(`[${i}] ${nodeName}: target=${ce.target.__id__}(${verify[ce.target.__id__]._name}) comp=${ce.component} handler=${ce.handler}`);
            });
        }
    }
}