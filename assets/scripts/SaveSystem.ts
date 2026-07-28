import { PlayerState } from './PlayerState';
import { PlayerData } from './PlayerData';
import { BaseSystem } from './BaseSystem';
import { DayNightSystem, DayNightPhase } from './DayNightSystem';
import { GlobalContainerStorage } from './GlobalContainerStorage';
import { EnemyManager, ZombieSaveData } from './EnemyManager';
import { TurretPlacementManager } from './TurretPlacementManager';
import { PlantGenerator } from './PlantGenerator';
import { Turret } from './Turret';
import { Container } from './Container';
import { ResourceItem } from './ResourceItem';
import { ResourceSpawner } from './ResourceSpawner';
import { director, instantiate, Node, Prefab } from 'cc';

const SAVE_KEY = 'game_save_v1';
const PENDING_LOAD_KEY = 'game_pending_load';

/** 建筑保存数据 */
export interface BuildingSaveData {
    /** 建筑类型 */
    type: 'turret' | 'plant' | 'container';
    /** 预制体节点名（用于匹配预制体） */
    prefabName: string;
    /** 相对于父节点的本地坐标 X */
    localX: number;
    /** 相对于父节点的本地坐标 Y */
    localY: number;
    /** 当前血量 */
    hp: number;
    /** 发电机唯一 ID（仅 plant 类型有效） */
    plantId?: number;
}

/** 地图资源矿点保存数据 */
export interface ResourceSaveData {
    /** 资源类型 */
    resourceType: string;
    /** 相对于父节点的本地坐标 X */
    localX: number;
    /** 相对于父节点的本地坐标 Y */
    localY: number;
    /** 剩余耐久 */
    hp: number;
}

export interface SaveData {
    timestamp: number;
    playerPos: {
        x: number;
        y: number;
    };
    playerState: {
        hp: number;
        maxHp: number;
        fatigue: number;
        attackDamage: number;
        repairPerHit: number;
        repairRange: number;
        moveSpeed: number;
        profession: string;
        bonusSpeed: number;
        bonusYield: number;
        fatigueGainBase: number;
        fatigueReduction: number;
        collectorSpeedLevel: number;
        collectorYieldLevel: number;
        collectorFatigueLevel: number;
        upgradePoints: number;
        walkSpeedMultiplier: number;
        hpMultiplier: number;
        fatigueGainMultiplier: number;
        woodCollectMultiplier: number;
        copperCollectMultiplier: number;
        ironCollectMultiplier: number;
        remoteRepairLevel: number;
        remoteRepairRange: number;
        remoteRepairHealPerSec: number;
        remoteMaterialEnabled: boolean;
        materialSaveRate: number;
        powerSaveRate: number;
        attackDamageMultiplier: number;
        weaponMode: boolean;
    };
    playerData: {
        money: number;
        woodCount: number;
        copperCount: number;
        ironCount: number;
    };
    baseSystem: {
        currentLevel: number;
        baseHp: number;
    };
    dayNight: {
        currentDay: number;
        phase: number;
        elapsed: number;
    };
    containerStorage: {
        storedWood: number;
        storedCopper: number;
        storedIron: number;
    };
    zombies: ZombieSaveData[];
    /** 建筑（炮塔/发电机/集装箱） */
    buildings: BuildingSaveData[];
    /** 地图资源矿点（木/铁/铜） */
    resources: ResourceSaveData[];
}

export class SaveSystem {
    /** 保存当前游戏进度 */
    static save(): boolean {
        const ps = PlayerState.instance;
        const pd = PlayerData.instance;
        const bs = BaseSystem.instance;
        const dn = DayNightSystem.instance;
        const cs = GlobalContainerStorage.instance;

        if (!ps || !pd || !bs || !dn) {
            console.warn('[SaveSystem] 保存失败：核心系统未就绪');
            return false;
        }

        // 获取玩家本地坐标（相对于父节点 YSortLayer，不受 GameWorld 移动影响）
        const playerNode = ps.node;
        const playerPos = playerNode
            ? { x: playerNode.position.x, y: playerNode.position.y }
            : { x: ps.worldX, y: ps.worldY };

        const data: SaveData = {
            timestamp: Date.now(),
            playerPos,
            playerState: {
                hp: ps.hp,
                maxHp: ps.maxHp,
                fatigue: ps.fatigue,
                attackDamage: ps.attackDamage,
                repairPerHit: ps.repairPerHit,
                repairRange: ps.repairRange,
                moveSpeed: ps.moveSpeed,
                profession: ps.profession,
                bonusSpeed: ps.bonusSpeed,
                bonusYield: ps.bonusYield,
                fatigueGainBase: ps.fatigueGainBase,
                fatigueReduction: ps.fatigueReduction,
                collectorSpeedLevel: ps.collectorSpeedLevel,
                collectorYieldLevel: ps.collectorYieldLevel,
                collectorFatigueLevel: ps.collectorFatigueLevel,
                upgradePoints: ps.upgradePoints,
                walkSpeedMultiplier: ps.walkSpeedMultiplier,
                hpMultiplier: ps.hpMultiplier,
                fatigueGainMultiplier: ps.fatigueGainMultiplier,
                woodCollectMultiplier: ps.woodCollectMultiplier,
                copperCollectMultiplier: ps.copperCollectMultiplier,
                ironCollectMultiplier: ps.ironCollectMultiplier,
                remoteRepairLevel: ps.remoteRepairLevel,
                remoteRepairRange: ps.remoteRepairRange,
                remoteRepairHealPerSec: ps.remoteRepairHealPerSec,
                remoteMaterialEnabled: ps.remoteMaterialEnabled,
                materialSaveRate: ps.materialSaveRate,
                powerSaveRate: ps.powerSaveRate,
                attackDamageMultiplier: ps.attackDamageMultiplier,
                weaponMode: ps.weaponMode,
            },
            playerData: {
                money: pd.money,
                woodCount: pd.woodCount,
                copperCount: pd.copperCount,
                ironCount: pd.ironCount,
            },
            baseSystem: {
                currentLevel: bs.currentLevel,
                baseHp: bs.baseHp,
            },
            dayNight: {
                currentDay: dn.currentDay,
                phase: dn.phase,
                elapsed: dn.elapsedTime,
            },
            containerStorage: {
                storedWood: cs ? cs.storedWood : 0,
                storedCopper: cs ? cs.storedCopper : 0,
                storedIron: cs ? cs.storedIron : 0,
            },
            zombies: EnemyManager.getZombieData(),
            buildings: SaveSystem.getBuildingData(),
            resources: SaveSystem.getResourceData(),
        };

        console.log(`[SaveSystem] 保存 - 建筑数量: ${data.buildings.length}, 资源矿点: ${data.resources.length}`);

        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            console.log('[SaveSystem] 游戏已保存');
            return true;
        } catch (e) {
            console.error('[SaveSystem] 保存失败:', e);
            return false;
        }
    }

    /** 是否有存档 */
    static hasSave(): boolean {
        return localStorage.getItem(SAVE_KEY) !== null;
    }

    /** 读取存档数据 */
    static load(): SaveData | null {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            return JSON.parse(raw) as SaveData;
        } catch (e) {
            console.error('[SaveSystem] 读取存档失败:', e);
            return null;
        }
    }

    /** 删除存档 */
    static deleteSave(): void {
        localStorage.removeItem(SAVE_KEY);
    }

    /** 标记：下次进入 1.scene 时应加载存档 */
    static markPendingLoad(): void {
        localStorage.setItem(PENDING_LOAD_KEY, '1');
    }

    /** 检查是否有待加载的存档 */
    static hasPendingLoad(): boolean {
        return localStorage.getItem(PENDING_LOAD_KEY) !== null;
    }

    /** 消费待加载标记并返回存档数据 */
    static consumePendingLoad(): SaveData | null {
        localStorage.removeItem(PENDING_LOAD_KEY);
        return SaveSystem.load();
    }

    /** 应用存档数据到各系统 */
    static apply(data: SaveData): void {
        const ps = PlayerState.instance;
        const pd = PlayerData.instance;
        const bs = BaseSystem.instance;
        const dn = DayNightSystem.instance;
        const cs = GlobalContainerStorage.instance;

        if (!ps || !pd || !bs || !dn) {
            console.warn('[SaveSystem] 应用存档失败：核心系统未就绪');
            return;
        }

        // 恢复 PlayerState
        const s = data.playerState;
        ps.hp = s.hp;
        ps.maxHp = s.maxHp;
        ps.fatigue = s.fatigue;
        ps.attackDamage = s.attackDamage;
        ps.repairPerHit = s.repairPerHit;
        ps.repairRange = s.repairRange;
        ps.moveSpeed = s.moveSpeed;
        ps.profession = s.profession;
        ps.bonusSpeed = s.bonusSpeed;
        ps.bonusYield = s.bonusYield;
        ps.fatigueGainBase = s.fatigueGainBase;
        ps.fatigueReduction = s.fatigueReduction;
        ps.collectorSpeedLevel = s.collectorSpeedLevel;
        ps.collectorYieldLevel = s.collectorYieldLevel;
        ps.collectorFatigueLevel = s.collectorFatigueLevel;
        ps.upgradePoints = s.upgradePoints;
        ps.walkSpeedMultiplier = s.walkSpeedMultiplier;
        ps.hpMultiplier = s.hpMultiplier;
        ps.fatigueGainMultiplier = s.fatigueGainMultiplier;
        ps.woodCollectMultiplier = s.woodCollectMultiplier;
        ps.copperCollectMultiplier = s.copperCollectMultiplier;
        ps.ironCollectMultiplier = s.ironCollectMultiplier;
        ps.remoteRepairLevel = s.remoteRepairLevel;
        ps.remoteRepairRange = s.remoteRepairRange;
        ps.remoteRepairHealPerSec = s.remoteRepairHealPerSec;
        ps.remoteMaterialEnabled = s.remoteMaterialEnabled;
        ps.materialSaveRate = s.materialSaveRate;
        ps.powerSaveRate = s.powerSaveRate;
        ps.attackDamageMultiplier = s.attackDamageMultiplier;
        ps.weaponMode = s.weaponMode;

        // 恢复 PlayerData
        const d = data.playerData;
        pd.money = d.money;
        pd.woodCount = d.woodCount;
        pd.copperCount = d.copperCount;
        pd.ironCount = d.ironCount;

        // 恢复 BaseSystem
        const b = data.baseSystem;
        bs.currentLevel = b.currentLevel;
        bs.baseHp = b.baseHp;

        // 恢复 DayNightSystem
        const dnData = data.dayNight;
        dn.currentDay = dnData.currentDay;
        dn.forcePhase(dnData.phase as DayNightPhase, true);
        dn.forceElapsed(dnData.elapsed);

        // 恢复玩家位置（使用本地坐标，相对于父节点 YSortLayer，不受 GameWorld 移动影响）
        let playerNode = ps.node;
        if (!playerNode || !playerNode.isValid) {
            // 回退方案：通过场景层级查找
            const scene = director.getScene();
            const gameWorld = scene?.getChildByName('GameWorld');
            const sortLayer = gameWorld?.getChildByName('YSortLayer');
            playerNode = sortLayer?.getChildByName('Player') ?? gameWorld?.getChildByName('Player') ?? null;
        }
        if (playerNode) {
            playerNode.setPosition(data.playerPos.x, data.playerPos.y, 0);
        } else {
            console.warn('[SaveSystem] 读档时找不到 Player 节点');
        }

        // 恢复 GlobalContainerStorage
        if (cs) {
            const c = data.containerStorage;
            cs.storedWood = c.storedWood;
            cs.storedCopper = c.storedCopper;
            cs.storedIron = c.storedIron;
        }

        // 恢复僵尸
        if (data.zombies && data.zombies.length > 0) {
            EnemyManager.restoreZombies(data.zombies);
        } else {
            console.log('[SaveSystem] apply 存档中无僵尸数据');
        }

        // 恢复建筑（炮塔/发电机/集装箱）
        if (data.buildings && data.buildings.length > 0) {
            console.log(`[SaveSystem] apply - 存档中有 ${data.buildings.length} 个建筑，开始恢复`);
            SaveSystem.restoreBuildings(data.buildings);
        } else {
            console.log(`[SaveSystem] apply - 存档中无建筑数据 (buildings=${data.buildings ? '存在(空数组)' : 'undefined'})`);
        }

        // 恢复地图资源矿点
        if (data.resources && data.resources.length > 0) {
            console.log(`[SaveSystem] apply - 存档中有 ${data.resources.length} 个资源矿点，开始恢复`);
            SaveSystem.restoreResources(data.resources);
        } else {
            console.log(`[SaveSystem] apply - 存档中无资源数据`);
        }
    }

    /** 收集场景中所有建筑的数据 */
    static getBuildingData(): BuildingSaveData[] {
        const result: BuildingSaveData[] = [];
        const mgr = TurretPlacementManager.instance;
        console.log(`[SaveSystem] getBuildingData - TurretPlacementManager: ${mgr ? '存在' : 'NULL'}`);
        if (!mgr) return result;

        const root = mgr.getPlacementRootPublic();
        console.log(`[SaveSystem] getBuildingData - placementRoot: ${root ? root.name : 'NULL'}, parent: ${root?.parent?.name ?? 'NULL'}`);
        if (!root) return result;

        // 收集炮塔
        const turrets = root.getComponentsInChildren(Turret);
        console.log(`[SaveSystem] getBuildingData - 找到 ${turrets.length} 个 Turret 组件`);
        for (const t of turrets) {
            if (!t.enabled || !t.node || !t.node.isValid) {
                console.log(`[SaveSystem] getBuildingData - 跳过 Turret: enabled=${t.enabled}, node=${t.node ? '存在' : 'NULL'}, valid=${t.node?.isValid}`);
                continue;
            }
            result.push({
                type: 'turret',
                prefabName: t.node.name,
                localX: t.node.position.x,
                localY: t.node.position.y,
                hp: t.hp,
            });
        }

        // 收集发电机
        console.log(`[SaveSystem] getBuildingData - PlantGenerator.placedMap.size: ${PlantGenerator.placedMap.size}`);
        for (const plant of PlantGenerator.placedMap.values()) {
            if (!plant.node || !plant.node.isValid) {
                console.log(`[SaveSystem] getBuildingData - 跳过 Plant: node=${plant.node ? '存在' : 'NULL'}, valid=${plant.node?.isValid}`);
                continue;
            }
            console.log(`[SaveSystem] getBuildingData - plant: name=${plant.node.name}, parent=${plant.node.parent?.name}, localPos=(${plant.node.position.x}, ${plant.node.position.y}), worldPos=(${plant.node.worldPosition.x}, ${plant.node.worldPosition.y})`);
            result.push({
                type: 'plant',
                prefabName: plant.node.name,
                localX: plant.node.position.x,
                localY: plant.node.position.y,
                hp: plant.hp,
                plantId: plant.plantId,
            });
        }

        // 收集集装箱
        const containers = root.getComponentsInChildren(Container);
        console.log(`[SaveSystem] getBuildingData - 找到 ${containers.length} 个 Container 组件`);
        for (const c of containers) {
            if (!c.enabled || !c.node || !c.node.isValid) {
                console.log(`[SaveSystem] getBuildingData - 跳过 Container: enabled=${c.enabled}, node=${c.node ? '存在' : 'NULL'}, valid=${c.node?.isValid}`);
                continue;
            }
            result.push({
                type: 'container',
                prefabName: c.node.name,
                localX: c.node.position.x,
                localY: c.node.position.y,
                hp: c.hp,
            });
        }

        console.log(`[SaveSystem] getBuildingData - 总计收集: ${result.length} 个建筑`);
        return result;
    }

    /** 按 plantId 匹配发电机预制体 */
    private static matchPlantPrefabById(prefabs: Prefab[], plantId: number): Prefab | null {
        for (const p of prefabs) {
            if (!p.data) {
                console.warn(`[SaveSystem] matchPlantPrefabById - prefab.data 为空`);
                continue;
            }
            // getComponentInChildren 可查找根节点及所有子节点上的 PlantGenerator 组件
            const pg = p.data.getComponentInChildren(PlantGenerator);
            console.log(`[SaveSystem] matchPlantPrefabById - prefab=${p.name}, data.name=${p.data.name}, plantId=${pg?.plantId}, target=${plantId}`);
            if (pg && pg.plantId === plantId) return p;
        }
        return null;
    }

    /** 恢复建筑到场景中 */
    static restoreBuildings(data: BuildingSaveData[]): void {
        console.log(`[SaveSystem] restoreBuildings - 开始恢复 ${data.length} 个建筑`);
        const mgr = TurretPlacementManager.instance;
        console.log(`[SaveSystem] restoreBuildings - TurretPlacementManager: ${mgr ? '存在' : 'NULL'}`);
        if (!mgr) {
            console.warn('[SaveSystem] restoreBuildings - TurretPlacementManager 不存在，无法恢复建筑');
            return;
        }

        const root = mgr.getPlacementRootPublic();
        console.log(`[SaveSystem] restoreBuildings - placementRoot: ${root ? root.name : 'NULL'}, parent: ${root?.parent?.name ?? 'NULL'}`);
        if (!root) {
            console.warn('[SaveSystem] restoreBuildings - placementRoot 不存在，无法恢复建筑');
            return;
        }

        // 先清除场景中已有的建筑（避免重复）
        const existingTurrets = root.getComponentsInChildren(Turret);
        for (const t of existingTurrets) {
            if (t.node && t.node.isValid) t.node.destroy();
        }
        const existingContainers = root.getComponentsInChildren(Container);
        for (const c of existingContainers) {
            if (c.node && c.node.isValid) c.node.destroy();
        }
        // 清除发电机：停用预置节点
        for (const plant of PlantGenerator.placedMap.values()) {
            if (plant.node && plant.node.isValid) {
                plant.node.active = false;
            }
        }
        PlantGenerator.placedMap.clear();

        // 辅助：匹配预制体
        const matchPrefab = (prefabs: Prefab[], name: string): Prefab | null => {
            for (const p of prefabs) {
                const pName = p.data?.name ?? p.name;
                if (pName === name) return p;
            }
            return null;
        };

        for (const bd of data) {
            console.log(`[SaveSystem] restoreBuildings - 恢复: type=${bd.type}, prefabName=${bd.prefabName}, pos=(${bd.localX}, ${bd.localY})`);
            let prefab: Prefab | null = null;
            let node: Node | null = null;

            switch (bd.type) {
                case 'turret': {
                    prefab = matchPrefab(mgr.turretPrefabs, bd.prefabName);
                    console.log(`[SaveSystem] restoreBuildings - turret prefab匹配: ${prefab ? '成功' : '失败'}, turretPrefabs数量=${mgr.turretPrefabs?.length ?? 0}`);
                    if (!prefab) break;
                    node = instantiate(prefab);
                    node.setParent(root);
                    node.setPosition(bd.localX, bd.localY, 0);
                    const turret = node.getComponent(Turret);
                    if (turret) {
                        turret.enabled = true;
                        // start() 会在下一帧将 hp 重置为 maxHp，延迟覆盖
                        turret.scheduleOnce(() => {
                            turret.hp = bd.hp;
                        }, 0);
                    }
                    break;
                }
                case 'plant': {
                    // 发电机是场景中预置节点（非预制体实例化），plantPrefabs 可能为空
                    // 策略：从整个场景中按 plantId 查找预置节点，激活并恢复位置
                    const plantId = bd.plantId ?? 0;
                    let plantNode: Node | null = null;

                    // 1. 在整个场景中搜索匹配 plantId 的发电机节点（不限于 placementRoot）
                    const scene = director.getScene();
                    if (scene) {
                        const allPlants = scene.getComponentsInChildren(PlantGenerator);
                        console.log(`[SaveSystem] restoreBuildings - 场景中找到 ${allPlants.length} 个 PlantGenerator`);
                        for (const pg of allPlants) {
                            if (pg.plantId === plantId && pg.node && pg.node.isValid) {
                                plantNode = pg.node;
                                break;
                            }
                        }
                    }

                    if (plantNode) {
                        // 找到了场景预置节点，激活并恢复位置
                        console.log(`[SaveSystem] restoreBuildings - 找到预置节点 plantId=${plantId}: ${plantNode.name}, parent=${plantNode.parent?.name}`);
                        console.log(`[SaveSystem] restoreBuildings - plant 恢复前: localPos=(${plantNode.position.x}, ${plantNode.position.y}), worldPos=(${plantNode.worldPosition.x}, ${plantNode.worldPosition.y})`);
                        plantNode.active = true;
                        plantNode.setPosition(bd.localX, bd.localY, 0);
                        console.log(`[SaveSystem] restoreBuildings - plant 恢复后: localPos=(${plantNode.position.x}, ${plantNode.position.y}), worldPos=(${plantNode.worldPosition.x}, ${plantNode.worldPosition.y}), 存档值=(${bd.localX}, ${bd.localY})`);
                        const plant = plantNode.getComponent(PlantGenerator);
                        if (plant) {
                            plant.markPlaced();
                            plant.scheduleOnce(() => { plant.hp = bd.hp; }, 0);
                        }
                        node = plantNode;
                    } else {
                        // 2. 场景中无预置节点，尝试从 prefab 动态创建
                        prefab = SaveSystem.matchPlantPrefabById(mgr.plantPrefabs, plantId);
                        if (!prefab) {
                            prefab = matchPrefab(mgr.plantPrefabs, bd.prefabName);
                        }
                        console.log(`[SaveSystem] restoreBuildings - plant prefab匹配: ${prefab ? '成功' : '失败'}`);
                        if (!prefab) break;
                        plantNode = instantiate(prefab);
                        plantNode.setParent(root);
                        plantNode.active = true;
                        plantNode.setPosition(bd.localX, bd.localY, 0);
                        const plant = plantNode.getComponent(PlantGenerator);
                        if (plant) {
                            plant.markPlaced();
                            plant.scheduleOnce(() => { plant.hp = bd.hp; }, 0);
                        }
                        node = plantNode;
                    }
                    break;
                }
                case 'container': {
                    prefab = mgr.containerPrefab;
                    console.log(`[SaveSystem] restoreBuildings - container prefab: ${prefab ? '存在' : 'NULL'}`);
                    if (!prefab) break;
                    node = instantiate(prefab);
                    node.setParent(root);
                    node.setPosition(bd.localX, bd.localY, 0);
                    const container = node.getComponent(Container);
                    if (container) {
                        container.enabled = true;
                        container.onPlaced();  // onPlaced 会设置 hp = maxHp
                        container.hp = bd.hp;  // 用存档值覆盖
                    }
                    break;
                }
            }

            // 绑定 HealthBar
            if (node) {
                const bar = mgr.findHealthBarPublic(node);
                if (bar) {
                    bar.bindParent(node);
                    bar.finishBuild();
                }
            }
        }

        // 更新电力状态
        BaseSystem.instance?.updatePowerStatus();
        console.log('[SaveSystem] restoreBuildings - 建筑恢复完成');
    }

    /** 收集场景中所有资源矿点的数据 */
    static getResourceData(): ResourceSaveData[] {
        const result: ResourceSaveData[] = [];
        const spawner = ResourceSpawner.instance;
        if (!spawner) return result;

        const root = spawner.getResourceRoot();
        if (!root) return result;

        const items = root.getComponentsInChildren(ResourceItem);
        for (const item of items) {
            if (!item.enabled || !item.node || !item.node.isValid) continue;
            result.push({
                resourceType: item.resourceType,
                localX: item.node.position.x,
                localY: item.node.position.y,
                hp: item.hp,
            });
        }

        return result;
    }

    /** 恢复资源矿点到场景中 */
    static restoreResources(data: ResourceSaveData[]): void {
        console.log(`[SaveSystem] restoreResources - 开始恢复 ${data.length} 个资源`);
        const spawner = ResourceSpawner.instance;
        if (!spawner) {
            console.warn('[SaveSystem] restoreResources - ResourceSpawner.instance 为 null，资源恢复失败');
            return;
        }

        const root = spawner.getResourceRoot();
        if (!root) {
            console.warn('[SaveSystem] restoreResources - getResourceRoot() 返回 null，资源恢复失败');
            return;
        }
        console.log(`[SaveSystem] restoreResources - 资源根节点: ${root.name}`);

        // 先清除场景中已有的资源矿点
        const existing = root.getComponentsInChildren(ResourceItem);
        console.log(`[SaveSystem] restoreResources - 清除 ${existing.length} 个已有资源`);
        for (const item of existing) {
            if (item.node && item.node.isValid) item.node.destroy();
        }

        // 恢复资源矿点
        let restored = 0;
        for (const rd of data) {
            const prefab = spawner.getPrefabByType(rd.resourceType);
            if (!prefab) {
                if (restored === 0) console.warn(`[SaveSystem] restoreResources - 类型 ${rd.resourceType} 无对应预制体`);
                continue;
            }

            const node = instantiate(prefab);
            node.setParent(root);
            node.setPosition(rd.localX, rd.localY, 0);
            const item = node.getComponent(ResourceItem);
            if (item) {
                item.hp = rd.hp;
            }
            restored++;
        }
        console.log(`[SaveSystem] restoreResources - 资源矿点恢复完成，共 ${restored}/${data.length} 个`);
    }
}