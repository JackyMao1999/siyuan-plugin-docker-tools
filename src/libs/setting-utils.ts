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
     * 添加左侧 tab 导航：面板打开后会把设置项重构成「左侧分组列表 + 右侧分组内容」，
     * 与思源原生设置界面同构（config__side / b3-list-item / config__tab-container）
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
            // row 方向不会给元素加 fn__size200（200px 固定宽），布局元素需要占满整行
            direction: "row",
            value: "",
            createElement: () => {
                const placeholder = document.createElement("div");
                // 思源在遍历完所有设置项后才组装完 DOM，这里等一个 tick 再重构
                setTimeout(() => this.buildSidebarLayout(placeholder), 0);
                return placeholder;
            },
            getEleVal: () => null,
            setEleVal: () => { /* 导航不参与配置读写 */ },
        });
    }

    /** 把设置行重构成「左侧 tab 列表 + 右侧分组容器」 */
    private buildSidebarLayout(placeholder: HTMLElement) {
        const content = (placeholder.closest(".b3-dialog__content") || placeholder.closest(SETTING_ROW_SELECTOR)?.parentElement) as HTMLElement | null;
        if (!content || content.querySelector(".plugin-setting__layout")) return;

        const tabRow = placeholder.closest(SETTING_ROW_SELECTOR) as HTMLElement | null;
        const rows = Array.from(content.querySelectorAll<HTMLElement>(SETTING_ROW_SELECTOR));

        // 每个设置行属于哪个分组（通过「行内是否包含该设置项的控件」判断）
        const tabIds = new Set(this.tabs.map((tab) => tab.id));
        const groupOf = (row: HTMLElement): string => {
            for (const [itemKey, element] of this.elements) {
                if (element && row.contains(element)) {
                    const group = this.itemGroups.get(itemKey) || "";
                    return tabIds.has(group) ? group : this.activeTab;
                }
            }
            return this.activeTab;
        };

        // config__panel + config__side + config__tab-wrap/•container 都是思源原生设置的类，
        // 复用它们即可拿到左侧 280px 列表、分隔线、圆角与内间距等原生样式
        const layout = document.createElement("div");
        layout.className = "fn__flex-1 fn__flex config__panel plugin-setting__layout";
        const side = document.createElement("div");
        side.className = "config__side b3-list b3-list--background";
        const sideList = document.createElement("ul");
        sideList.className = "config__tab-scroll";
        side.appendChild(sideList);
        const wrap = document.createElement("div");
        wrap.className = "config__tab-wrap";
        layout.append(side, wrap);

        const containers = new Map<string, HTMLElement>();
        for (const tab of this.tabs) {
            const item = document.createElement("li");
            item.className = "b3-list-item";
            item.dataset.name = tab.id;
            const text = document.createElement("span");
            text.className = "b3-list-item__text";
            text.textContent = tab.label;
            item.appendChild(text);
            item.addEventListener("click", () => this.switchTab(tab.id, containers, sideList));
            sideList.appendChild(item);

            const container = document.createElement("div");
            container.className = "config__tab-container";
            container.dataset.name = tab.id;
            wrap.appendChild(container);
            containers.set(tab.id, container);
        }

        // 把设置行搬进各自分组；导航占位行本身丢弃（信息已变成左侧列表）
        for (const row of rows) {
            if (row === tabRow) continue;
            containers.get(groupOf(row))?.appendChild(row);
        }
        tabRow?.remove();
        content.appendChild(layout);
        this.switchTab(this.activeTab, containers, sideList);
    }

    /** 切换分组：只显示对应容器，并同步左侧选中态 */
    private switchTab(tabId: string, containers: Map<string, HTMLElement>, sideList: HTMLElement) {
        this.activeTab = tabId;
        containers.forEach((container, id) => container.classList.toggle("fn__none", id !== tabId));
        sideList.querySelectorAll<HTMLElement>(".b3-list-item").forEach((item) => {
            item.classList.toggle("b3-list-item--focus", item.dataset.name === tabId);
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