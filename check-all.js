const fs = require('fs');
const data = JSON.parse(fs.readFileSync('d:/COCOS项目/NewProject_2/assets/1.scene','utf8'));

// Find all key nodes and buttons
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ === 'cc.Button') {
        const nodeIdx = data[i].node.__id__;
        const nodeName = data[nodeIdx]._name;
        console.log('Button['+i+'] on', nodeName, '('+nodeIdx+') clickEvents:', JSON.stringify(data[i].clickEvents));
    }
}

// Find Btn_BuildTurret node
for (let i = 0; i < data.length; i++) {
    if (data[i]._name === 'Btn_BuildTurret') {
        console.log('Btn_BuildTurret node:', i, '_components:', JSON.stringify(data[i]._components));
    }
}

// Find stale TurretBuildPanelUI
for (let i = 0; i < data.length; i++) {
    if (data[i].__type__ && data[i].__type__.includes('e52e8')) {
        console.log('TurretBuildPanelUI['+i+'] node:', data[i].node, 'turretPanel:', data[i].turretPanel);
    }
}