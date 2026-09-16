/*
 * Copyright (c) 2023 by frostime. All Rights Reserved.
 * @Author       : frostime
 * @Date         : 2023-12-17 18:28:19
 * @FilePath     : /src/libs/setting-utils.ts
 * @LastEditTime : 2024-05-21 16:57:53
 * @Description  : 
 */

import { Plugin, Setting } from 'siyuan';


/**
 * The default function to get the value of the element
 * @param type 
 * @returns 
 */
const createDefaultGetter = (type: TSettingItemType) => {
    let getter: (ele: HTMLElement) => any;
    switch (type) {
        case 'checkbox':
            getter = (ele: HTMLInputElement) => {
                return ele.checked;
            };
            break;
        case 'select':
        case 'slider':
        case 'textinput':
        case 'textarea':
            getter = (ele: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) => {
                return ele.value;
            };
            break;
        case 'number':
            getter = (ele: HTMLInputElement) => {
                return parseInt(ele.value);
            }
            break;
        default:
            getter = () => null;
            break;
    }
    return getter;
}


/**
 * The default function to set the value of the element
 * @param type 
 * @returns 
 */
const createDefaultSetter = (type: TSettingItemType) => {
    let setter: (ele: HTMLElement, value: any) => void;
    switch (type) {
        case 'checkbox':
            setter = (ele: HTMLInputElement, value: any) => {
                ele.checked = value;
            };
            break;
        case 'select':
        case 'slider':
        case 'textinput':
        case 'textarea':
        case 'number':
            setter = (ele: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: any) => {
                ele.value = value;
            };
            break;
        default:
            setter = () => {};
            break;
    }
    return setter;

}


/** 思源设置面板中每一行的选择器（Setting.open 生成：<div class="b3-label config-item">…） */
const SETTING_ROW_SELECTOR = ".config-item";

export class SettingUtils {
    plugin: Plugin;
    name: string;
    file: string;

    settings: Map<string, ISettingUtilsItem> = new Map();
    elements: Map<string, HTMLElement> = new Map();
    /** 仅用于界面分区/切换的 key（不写入配置文件） */
    private sectionKeys = new Set<string>();
    private sectionSeq = 0;
    /** 设置项所属分组（key -> groupId） */
    private itemGroups = new Map<string, string>();
    /** 当前 addItem 归属的分组 */
    private currentGroup = "";
    /** tab 定义与当前选中项 */
    private tabs: { id: string; label: string }[] = [];
    private activeTab = "";
    /** 已渲染的设置行，用于 tab 切换时显示/隐藏 */
    private rowElements: HTMLElement[] = [];

    constructor(args: {
        plugin: Plugin,
        name?: string,
        callback?: (data: any) => void,
        width?: string,
        height?: string
    }) {
        this.name = args.name ?? 'settings';
        this.plugin = args.plugin;
        this.file = this.name.endsWith('.json') ? this.name : `${this.name}.json`;
        this.plugin.setting = new Setting({
            width: args.width,
            height: args.height,
            confirmCallback: () => {
                for (let key of this.settings.keys()) {
                    this.updateValueFromElement(key);
                }
                let data = this.dump();
                if (args.callback !== undefined) {
                    args.callback(data);
                }
                this.plugin.data[this.name] = data;
                this.save(data);
            },
            destroyCallback: () => {
                //Restore the original value
                for (let key of this.settings.keys()) {
                    this.updateElementFromValue(key);
                }
            }
        });
    }

    async load() {
        let data = await this.plugin.loadData(this.file);
        console.debug('Load config:', data);
        if (data) {
            for (let [key, item] of this.settings) {
                item.value = data?.[key] ?? item.value;
            }
        }
        this.plugin.data[this.name] = this.dump();
        return data;
    }

    async save(data?: any) {
        data = data ?? this.dump();
        await this.plugin.saveData(this.file, this.dump());
        console.debug('Save config:', data);
        return data;
    }

    /**
     * read the data after saving
     * @param key key name
     * @returns setting item value
     */
    get(key: string) {
        return this.settings.get(key)?.value;
    }

    /**
     * Set data to this.settings, 
     * but do not save it to the configuration file
     * @param key key name
     * @param value value
     */
    set(key: string, value: any) {
        let item = this.settings.get(key);
        if (item) {
            item.value = value;
            this.updateElementFromValue(key);
        }
    }

    /**
     * Set and save setting item value
     * If you want to set and save immediately you can use this method
     * @param key key name
     * @param value value
     */
    async setAndSave(key: string, value: any) {
        let item = this.settings.get(key);
        if (item) {
            item.value = value;
            this.updateElementFromValue(key);
            await this.save();
        }
    }

    /**
      * Read in the value of element instead of setting obj in real time
      * @param key key name
      * @param apply whether to apply the value to the setting object
      *        if true, the value will be applied to the setting object
      * @returns value in html
      */
    take(key: string, apply: boolean = false) {
        let item = this.settings.get(key);
        let element = this.elements.get(key) as any;
        if (!element) {
            return
        }
        if (apply) {
            this.updateValueFromElement(key);
        }
        return item.getEleVal(element);
    }

    /**
     * Read data from html and save it
     * @param key key name
     * @param value value
     * @return value in html
     */
    async takeAndSave(key: string) {
        let value = this.take(key, true);
        await this.save();
        return value;
    }

    /**
     * Disable setting item
     * @param key key name
     */
    disable(key: string) {
        let element = this.elements.get(key) as any;
        if (element) {
            element.disabled = true;
        }
    }

    /**
     * Enable setting item
     * @param key key name
     */
    enable(key: string) {
        let element = this.elements.get(key) as any;
        if (element) {
            element.disabled = false;
        }
    }

    /**
     * 将设置项目导出为 JSON 对象
     * @returns object
     */
    dump(): Object {
        let data: any = {};
        for (let [key, item] of this.settings) {
            if (item.type === 'button') continue;
            if (this.sectionKeys.has(key)) continue;
            data[key] = item.value;
        }
        return data;
    }

    /**
     * 添加一个分组标题：把设置面板按功能点分区，避免所有项挤在一列里分不清归属
     * @param title 分组名称，例如「飞书知识库同步」
     * @param description 该分组管什么，显示在标题后面
     */
    addSection(title: string, description = "") {
        const key = `__section__${++this.sectionSeq}`;
        this.sectionKeys.add(key);
        this.addItem({
            key,
            title,
            description,
            type: 'custom',
            direction: 'column',
            value: '',
            createElement: () => {
                const element = document.createElement('div');
                element.className = 'plugin-setting__section-divider';
                // 元素插入设置面板后再给「整行」打标记：标题加粗 + 顶部分隔线
                setTimeout(() => {
                    const row = (element.closest('.b3-label') || element.parentElement) as HTMLElement | null;
                    row?.classList.add('plugin-setting__section-row');
                }, 0);
                return element;
            },
            getEleVal: () => null,
            setEleVal: () => { /* 分组标题不参与配置读写 */ },
        });
    }

    /**
     * 指定之后添加的设置项归属哪个 tab 分组（配合 addTabs 使用）
     * @param groupId 分组 id，需与 addTabs 中的 id 一致
     */
    useGroup(groupId: string) {
        this.currentGroup = groupId;
    }

    /**
     * 在设置面板顶部添加 tab 切换条：点击 tab 只显示该分组的设置项
     * @param tabs 分组定义，第一个为默认选中
     */
    addTabs(tabs: { id: string; label: string }[]) {
        this.tabs = tabs.slice();
        this.activeTab = this.tabs[0]?.id || "";
        const key = `__tabs__${++this.sectionSeq}`;
        this.sectionKeys.add(key);
        this.addItem({
            key,
            title: "",
            description: "",
            type: "custom",
            direction: "row",
            value: "",
            createElement: () => {
                // 面板每次打开都会重建 DOM，这里重置已记录的设置行
                this.rowElements = [];
                const wrap = document.createElement("div");
                wrap.className = "plugin-setting__tabs";
                for (const tab of this.tabs) {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "b3-button b3-button--outline plugin-setting__tab";
                    button.textContent = tab.label;
                    button.dataset.tab = tab.id;
                    button.onclick = () => {
                        this.activeTab = tab.id;
                        this.syncTabButtons(wrap);
                        this.applyTabVisibility();
                    };
                    wrap.appendChild(button);
                }
                setTimeout(() => {
                    // row 方向会生成空的标题与分隔线，去掉后这一行只留 tab 条
                    const row = wrap.closest(SETTING_ROW_SELECTOR) as HTMLElement | null;
                    row?.querySelectorAll(".config-name, .fn__hr").forEach((element) => element.remove());
                    this.syncTabButtons(wrap);
                    this.applyTabVisibility();
                }, 0);
                return wrap;
            },
            getEleVal: () => null,
            setEleVal: () => { /* tab 条不参与配置读写 */ },
        });
    }

    /** 记录设置项所在的行元素，并按当前 tab 决定是否隐藏 */
    private trackRow(key: string, element: HTMLElement) {
        const group = this.itemGroups.get(key) || "";
        // 行元素由思源在 createActionElement 之后组装进 DOM，需等一个 tick 再定位
        setTimeout(() => {
            const row = element?.closest?.(SETTING_ROW_SELECTOR) as HTMLElement | null;
            if (!row) return;
            if (group) {
                row.dataset.pluginGroup = group;
            }
            if (!this.rowElements.includes(row)) {
                this.rowElements.push(row);
            }
            this.applyTabVisibility();
        }, 0);
    }

    /** 按当前选中 tab 显示/隐藏各设置行（无分组的行始终显示） */
    private applyTabVisibility() {
        if (!this.tabs.length) return;
        for (const row of this.rowElements) {
            const group = row.dataset.pluginGroup || "";
            row.classList.toggle("fn__none", !!group && group !== this.activeTab);
        }
    }

    /** 刷新 tab 按钮的选中样式 */
    private syncTabButtons(wrap: HTMLElement) {
        wrap.querySelectorAll<HTMLElement>(".plugin-setting__tab").forEach((button) => {
            button.classList.toggle("plugin-setting__tab--active", button.dataset.tab === this.activeTab);
        });
    }

    addItem(item: ISettingUtilsItem) {
        this.settings.set(item.key, item);
        this.itemGroups.set(item.key, this.currentGroup);
        const IsCustom = item.type === 'custom';
        let error = IsCustom && (item.createElement === undefined || item.getEleVal === undefined || item.setEleVal === undefined);
        if (error) {
            console.error('The custom setting item must have createElement, getEleVal and setEleVal methods');
            return;
        }

        if (item.getEleVal === undefined) {
            item.getEleVal = createDefaultGetter(item.type);
        }
        if (item.setEleVal === undefined) {
            item.setEleVal = createDefaultSetter(item.type);
        }

        if (item.createElement === undefined) {
            let itemElement = this.createDefaultElement(item);
            this.elements.set(item.key, itemElement);
            this.plugin.setting.addItem({
                title: item.title,
                description: item?.description,
                direction: item?.direction,
                createActionElement: () => {
                    this.updateElementFromValue(item.key);
                    let element = this.getElement(item.key);
                    this.trackRow(item.key, element);
                    return element;
                }
            });
        } else {
            this.plugin.setting.addItem({
                title: item.title,
                description: item?.description,
                direction: item?.direction,
                createActionElement: () => {
                    let val = this.get(item.key);
                    let element = item.createElement(val);
                    this.elements.set(item.key, element);
                    this.trackRow(item.key, element);
                    return element;
                }
            });
        }
    }

    createDefaultElement(item: ISettingUtilsItem) {
        let itemElement: HTMLElement;
        //阻止思源内置的回车键确认
        const preventEnterConfirm = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopImmediatePropagation();
            }
        }
        switch (item.type) {
            case 'checkbox':
                let element: HTMLInputElement = document.createElement('input');
                element.type = 'checkbox';
                element.checked = item.value;
                element.className = "b3-switch fn__flex-center";
                itemElement = element;
                element.onchange = item.action?.callback ?? (() => { });
                break;
            case 'select':
                let selectElement: HTMLSelectElement = document.createElement('select');
                selectElement.className = "b3-select fn__flex-center fn__size200";
                let options = item?.options ?? {};
                for (let val in options) {
                    let optionElement = document.createElement('option');
                    let text = options[val];
                    optionElement.value = val;
                    optionElement.text = text;
                    selectElement.appendChild(optionElement);
                }
                selectElement.value = item.value;
                selectElement.onchange = item.action?.callback ?? (() => { });
                itemElement = selectElement;
                break;
            case 'slider':
                let sliderElement: HTMLInputElement = document.createElement('input');
                sliderElement.type = 'range';
                sliderElement.className = 'b3-slider fn__size200 b3-tooltips b3-tooltips__n';
                sliderElement.ariaLabel = item.value;
                sliderElement.min = item.slider?.min.toString() ?? '0';
                sliderElement.max = item.slider?.max.toString() ?? '100';
                sliderElement.step = item.slider?.step.toString() ?? '1';
                sliderElement.value = item.value;
                sliderElement.onchange = () => {
                    sliderElement.ariaLabel = sliderElement.value;
                    item.action?.callback();
                }
                itemElement = sliderElement;
                break;
            case 'textinput':
                let textInputElement: HTMLInputElement = document.createElement('input');
                textInputElement.className = 'b3-text-field fn__flex-center fn__size200';
                textInputElement.value = item.value;
                textInputElement.onchange = item.action?.callback ?? (() => { });
                itemElement = textInputElement;
                textInputElement.addEventListener('keydown', preventEnterConfirm);
                break;
            case 'textarea':
                let textareaElement: HTMLTextAreaElement = document.createElement('textarea');
                textareaElement.className = "b3-text-field fn__block";
                textareaElement.value = item.value;
                textareaElement.onchange = item.action?.callback ?? (() => { });
                itemElement = textareaElement;
                break;
            case 'number':
                let numberElement: HTMLInputElement = document.createElement('input');
                numberElement.type = 'number';
                numberElement.className = 'b3-text-field fn__flex-center fn__size200';
                numberElement.value = item.value;
                itemElement = numberElement;
                numberElement.addEventListener('keydown', preventEnterConfirm);
                break;
            case 'button':
                let buttonElement: HTMLButtonElement = document.createElement('button');
                buttonElement.className = "b3-button b3-button--outline fn__flex-center fn__size200";
                buttonElement.innerText = item.button?.label ?? 'Button';
                buttonElement.onclick = item.button?.callback ?? (() => { });
                itemElement = buttonElement;
                break;
            case 'hint':
                let hintElement: HTMLElement = document.createElement('div');
                hintElement.className = 'b3-label fn__flex-center';
                itemElement = hintElement;
                break;
        }
        return itemElement;
    }

    /**
     * return the setting element
     * @param key key name
     * @returns element
     */
    getElement(key: string) {
        // let item = this.settings.get(key);
        let element = this.elements.get(key) as any;
        return element;
    }

    private updateValueFromElement(key: string) {
        let item = this.settings.get(key);
        if (item.type === 'button') return;
        let element = this.elements.get(key) as any;
        item.value = item.getEleVal(element);
    }

    private updateElementFromValue(key: string) {
        let item = this.settings.get(key);
        if (item.type === 'button') return;
        let element = this.elements.get(key) as any;
        item.setEleVal(element, item.value);
    }
}