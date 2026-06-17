const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Find Btn_OpenUpgrade and Btn_BuildTurret
let btnOpenUpgradeIdx = -1;
let btnBuildTurretIdx = -1;
let newTurretPanelIdx = -1;

for (let i = 0; i < data.length; i++) {
    if (data[i]._name === 'NewTurretPanel') newTurretPanelIdx = i;
    if (data[i]._name === 'Btn_OpenUpgrade') btnOpenUpgradeIdx = i;
    if (data[i]._name === 'Btn_BuildTurret') btnBuildTurretIdx = i;
}

console.log('NewTurretPanel:', newTurretPanelIdx);
console.log('Btn_OpenUpgrade:', btnOpenUpgradeIdx);
console.log('Btn_BuildTurret:', btnBuildTurretIdx);

// Find Button components
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ === 'cc.Button') {
        if (data[i].node && data[i].node.__id__ === btnOpenUpgradeIdx) {
            console.log('Btn_OpenUpgrade Button:', i, 'clickEvents:', JSON.stringify(data[i].clickEvents));
        }
        if (data[i].node && data[i].node.__id__ === btnBuildTurretIdx) {
            console.log('Btn_BuildTurret Button:', i, 'clickEvents:', JSON.stringify(data[i].clickEvents));
        }
    }
}

// Find TurretBuildPanelUI component
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('e52e8')) {
        console.log('TurretBuildPanelUI:', i, 'node:', data[i].node, 'turretPanel:', data[i].turretPanel);
    }
}