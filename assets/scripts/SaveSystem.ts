import { PlayerState } from './PlayerState';
import { PlayerData } from './PlayerData';
import { BaseSystem } from './BaseSystem';
import { DayNightSystem, DayNightPhase } from './DayNightSystem';
import { GlobalContainerStorage } from './GlobalContainerStorage';

const SAVE_KEY = 'game_save_v1';
const PENDING_LOAD_KEY = 'game_pending_load';

export interface SaveData {
    timestamp: number;
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

        const data: SaveData = {
            timestamp: Date.now(),
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
        };

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
        dn.forcePhase(dnData.phase as DayNightPhase);
        // 注意：elapsed 需要通过 forcePhase 间接设置，这里仅设置 phase

        // 恢复 GlobalContainerStorage
        if (cs) {
            const c = data.containerStorage;
            cs.storedWood = c.storedWood;
            cs.storedCopper = c.storedCopper;
            cs.storedIron = c.storedIron;
        }

        console.log('[SaveSystem] 存档已加载');
    }
}