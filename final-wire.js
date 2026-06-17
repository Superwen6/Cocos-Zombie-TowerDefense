const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Find indices
let canvasIdx = -1, newTurretPanelIdx = -1, btnOpenUpgradeIdx = -1, btnBuildTurretIdx = -1, btnClosePanelIdx = -1;

for (let i = 0; i < data.length; i++) {
    if (data[i]._name === 'Canvas') canvasIdx = i;
    if (data[i]._name === 'NewTurretPanel') newTurretPanelIdx = i;
    if (data[i]._name === 'Btn_OpenUpgrade') btnOpenUpgradeIdx = i;
    if (data[i]._name === 'Btn_BuildTurret') btnBuildTurretIdx = i;
    if (data[i]._name === 'Btn_ClosePanel') btnClosePanelIdx = i;
}

console.log('Canvas:', canvasIdx);
console.log('NewTurretPanel:', newTurretPanelIdx);
console.log('Btn_OpenUpgrade:', btnOpenUpgradeIdx);
console.log('Btn_BuildTurret:', btnBuildTurretIdx);
console.log('Btn_ClosePanel:', btnClosePanelIdx);

// Find TurretBuildPanelUI on Canvas
let compIdx = -1;
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('e52e8') && data[i].node && data[i].node.__id__ === canvasIdx) {
        compIdx = i;
        break;
    }
}

if (compIdx < 0) {
    // Find any TurretBuildPanelUI
    for (let i = 0; i < data.length; i++) {
        if (data[i].__type__ && data[i].__type__.includes('e52e8')) {
            compIdx = i;
            console.log('Found TurretBuildPanelUI at:', i, 'node:', data[i].node);
            // Move to Canvas
            data[i].node = { "__id__": canvasIdx };
            data[i].turretPanel = { "__id__": newTurretPanelIdx };
            // Add to Canvas _components
            const canvas = data[canvasIdx];
            if (!canvas._components.some(c => c.__id__ === i)) {
                canvas._components.push({ "__id__": i });
            }
            break;
        }
    }
}

console.log('TurretBuildPanelUI index:', compIdx);

// Wire click events
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ === 'cc.Button') {
        if (data[i].node && data[i].node.__id__ === btnOpenUpgradeIdx) {
            data[i].clickEvents = [{
                "__type__": "cc.ClickEvent",
                "target": { "__id__": canvasIdx },
                "component": "TurretBuildPanelUI",
                "_componentId": "e52e8hsdLJJfaJp50sJqkPb",
                "handler": "showPanel",
                "customEventData": ""
            }];
            console.log('Btn_OpenUpgrade → showPanel');
        }
        if (data[i].node && data[i].node.__id__ === btnBuildTurretIdx) {
            data[i].clickEvents = [{
                "__type__": "cc.ClickEvent",
                "target": { "__id__": canvasIdx },
                "component": "TurretBuildPanelUI",
                "_componentId": "e52e8hsdLJJfaJp50sJqkPb",
                "handler": "onBuildButtonClick",
                "customEventData": ""
            }];
            console.log('Btn_BuildTurret → onBuildButtonClick');
        }
        if (data[i].node && data[i].node.__id__ === btnClosePanelIdx) {
            data[i].clickEvents = [{
                "__type__": "cc.ClickEvent",
                "target": { "__id__": newTurretPanelIdx },
                "component": "",
                "_componentId": "",
                "handler": "active",
                "customEventData": ""
            }];
            console.log('Btn_ClosePanel → deactivate NewTurretPanel');
        }
    }
}

fs.writeFileSync('d:/COCOS项目/NewProject_2/assets/1.scene', JSON.stringify(data, null, 2));
console.log('Done.');