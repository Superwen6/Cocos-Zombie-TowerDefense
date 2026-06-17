const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Find Btn_ClosePanel node and its Button component
let btnClosePanelIdx = -1;
let newTurretPanelIdx = -1;
let buttonCompIdx = -1;

for (let i = 0; i < data.length; i++) {
    if (data[i]._name === 'NewTurretPanel') newTurretPanelIdx = i;
    if (data[i]._name === 'Btn_ClosePanel') btnClosePanelIdx = i;
}

console.log('NewTurretPanel:', newTurretPanelIdx);
console.log('Btn_ClosePanel:', btnClosePanelIdx);

// Find Button component on Btn_ClosePanel
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ === 'cc.Button' && data[i].node && data[i].node.__id__ === btnClosePanelIdx) {
        buttonCompIdx = i;
        break;
    }
}

console.log('Button component:', buttonCompIdx);

// Add click event to deactivate NewTurretPanel
if (buttonCompIdx >= 0) {
    data[buttonCompIdx].clickEvents = [{
        "__type__": "cc.ClickEvent",
        "target": { "__id__": newTurretPanelIdx },
        "component": "",
        "_componentId": "",
        "handler": "active",
        "customEventData": ""
    }];
    console.log('Click event added');
}

fs.writeFileSync('d:/COCOS项目/NewProject_2/assets/1.scene', JSON.stringify(data, null, 2));
console.log('Written');

// Verify
const verify = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));
console.log('Valid JSON, length:', verify.length);
const btn = verify[buttonCompIdx];
console.log('Button clickEvents:', JSON.stringify(btn.clickEvents));