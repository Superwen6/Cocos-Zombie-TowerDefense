const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Check node 44
console.log('Node 44:', data[44]._name, data[44].__type__);

// Find BuildPanelUI components
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('aed5d')) {
        console.log('BuildPanelUI at', i, 'node:', data[i].node, 'openPanelButton:', data[i].openPanelButton, 'panelRootNode:', data[i].panelRootNode);
    }
}

// Find TurretBuildPanelUI components
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('e52e8')) {
        console.log('TurretBuildPanelUI at', i, 'node:', data[i].node, 'turretPanel:', data[i].turretPanel);
    }
}

// Find key indices
for (let i = 0; i < data.length; i++) {
    if (data[i]._name === 'Btn_OpenTurret') console.log('Btn_OpenTurret:', i);
    if (data[i]._name === 'Btn_OpenUpgrade') console.log('Btn_OpenUpgrade:', i);
    if (data[i]._name === 'UpgradePanel') console.log('UpgradePanel:', i);
    if (data[i]._name === 'NewTurretPanel') console.log('NewTurretPanel:', i);
    if (data[i]._name === 'Canvas') console.log('Canvas:', i);
}