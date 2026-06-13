// 主题管理模块
(function() {
    // 主题类型枚举
    const ThemeType = {
        LIGHT: 'light',
        DARK: 'dark'
    };

    // 获取当前语言 (异步)
    async function getCurrentLanguage() {
        try {
            const result = await new Promise(resolve => chrome.storage.local.get(['preferredLang'], resolve));
            if (result.preferredLang) {
                return result.preferredLang;
            }
            // 后备：尝试从 localStorage 获取（如果 chrome.storage 未设置）
            const localLang = localStorage.getItem('preferredLang');
            if (localLang) return localLang;
        } catch (e) {
            console.warn('从 chrome.storage.local 或 localStorage 获取语言设置失败:', e);
        }
        // 默认：跟随浏览器 UI 语言（中文 => zh_CN，其它 => en）
        try {
            const ui = (chrome?.i18n?.getUILanguage?.() || '').toLowerCase();
            return ui.startsWith('zh') ? 'zh_CN' : 'en';
        } catch (_) { }
        return 'en';
    }
    
    // 获取当前主题状态的文本说明 (异步)
    async function getThemeStatusText(themeType) {
        const lang = await getCurrentLanguage();
        const themeTexts = {
            [ThemeType.LIGHT]: { 'zh_CN': '浅色模式', 'en': 'Light Mode' },
            [ThemeType.DARK]: { 'zh_CN': '深色模式', 'en': 'Dark Mode' }
        };

        const textsForCurrentTheme = themeTexts[themeType] || themeTexts[ThemeType.DARK];
        return textsForCurrentTheme[lang] || textsForCurrentTheme['zh_CN']; // 回退到中文
    }
    
    // 保存主题设置到本地存储
    function saveThemePreference(themeType) {
        try {
            localStorage.setItem('themePreference', themeType);
            
            // 同时保存到chrome.storage，以便History Viewer可以同步
            if (chrome && chrome.storage && chrome.storage.local) {
                chrome.storage.local.set({ currentTheme: themeType }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('无法保存主题到chrome.storage:', chrome.runtime.lastError);
                    }
                });
            }
        } catch (e) {
            console.error('无法保存主题偏好:', e);
        }
    }

    // 从本地存储加载主题设置
    function loadThemePreference() {
        try {
            const savedTheme = localStorage.getItem('themePreference');
            return (savedTheme === ThemeType.LIGHT || savedTheme === ThemeType.DARK) ? savedTheme : ThemeType.DARK;
        } catch (e) {
            console.error('无法加载主题偏好:', e);
            return ThemeType.DARK;
        }
    }

    // 更新主题图标显示
    function updateThemeIcons(themeType) {
        const darkModeIcon = document.getElementById('darkModeIcon');
        const lightModeIcon = document.getElementById('lightModeIcon');
        const systemModeIcon = document.getElementById('systemModeIcon');
        
        if (darkModeIcon && lightModeIcon) {
            darkModeIcon.style.display = 'none';
            lightModeIcon.style.display = 'none';
            if (systemModeIcon) systemModeIcon.style.display = 'none';
            
            if (themeType === ThemeType.DARK) {
                darkModeIcon.style.display = 'inline-block';
            } else {
                lightModeIcon.style.display = 'inline-block';
            }
        }
    }

    // 应用主题到文档
    function applyTheme(themeType) {
        const actualTheme = (themeType === ThemeType.LIGHT || themeType === ThemeType.DARK) ? themeType : ThemeType.DARK;
        
        // 直接设置 data-theme 属性
        if (actualTheme === ThemeType.DARK) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        
        // 同步实际主题到chrome.storage，以便History Viewer可以同步
        if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ currentTheme: actualTheme }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[主UI] 无法同步主题到storage:', chrome.runtime.lastError);
                }
            });
        }
        
        // 更新图标显示
        updateThemeIcons(actualTheme);
    }

    // 初始化主题切换功能
    function initializeThemeSwitcher() {
        const themeSwitcher = document.getElementById('themeSwitcher');
        if (!themeSwitcher) {
            // 仍然应用主题，但不初始化切换按钮的交互
            applyTheme(loadThemePreference());
            return;
        }
        
        // 获取当前主题
        const savedTheme = loadThemePreference();
        
        const themeSwitcherTooltip = document.getElementById('themeSwitcherTooltip');

        // 更新主题提示文本的函数 - 只显示主题状态 (异步)
        async function updateThemeTooltip(tooltipElement, themeType) {
            if (tooltipElement) {
                tooltipElement.textContent = await getThemeStatusText(themeType);
            }
        }
        
        // 设置tooltip文本（仅显示主题状态，不显示"切换主题"文字）
        if (themeSwitcherTooltip) {
            // 设置初始状态为隐藏
            themeSwitcherTooltip.style.visibility = 'hidden';
            themeSwitcherTooltip.style.opacity = '0';
            
            // 设置初始提示文本，基于当前主题
            updateThemeTooltip(themeSwitcherTooltip, savedTheme);
            
            // 添加鼠标悬停事件
            themeSwitcher.addEventListener('mouseenter', async function() {
                // 在鼠标悬停时更新提示文本
                const currentTheme = loadThemePreference();
                await updateThemeTooltip(themeSwitcherTooltip, currentTheme);
                
                themeSwitcherTooltip.style.visibility = 'visible';
                themeSwitcherTooltip.style.opacity = '1';
            });
            
            themeSwitcher.addEventListener('mouseleave', function() {
                themeSwitcherTooltip.style.visibility = 'hidden';
                themeSwitcherTooltip.style.opacity = '0';
            });
        }
        
        // 应用主题
        applyTheme(savedTheme);
        
        // 点击切换主题
        themeSwitcher.addEventListener('click', function() {
            // 获取当前主题
            const currentTheme = loadThemePreference();
            
            // 仅在浅色和深色之间循环切换
            const newTheme = currentTheme === ThemeType.DARK ? ThemeType.LIGHT : ThemeType.DARK;
            
            // 保存并应用新主题
            saveThemePreference(newTheme);
            applyTheme(newTheme);
            
            // 立即更新提示文本
            if (themeSwitcherTooltip) {
                updateThemeTooltip(themeSwitcherTooltip, newTheme);
            }
        });

        // 监听语言变化以更新工具提示
        if (chrome && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener(async (changes, areaName) => {
                if (areaName === 'local' && changes.preferredLang) {
                    const currentTheme = loadThemePreference();
                    if (themeSwitcherTooltip) {
                        await updateThemeTooltip(themeSwitcherTooltip, currentTheme);
                    }
                }
            });
        }
    }

    // 在文档加载完成后初始化
    function initialize() {
        // Apply theme immediately to prevent flash before DOMContentLoaded.
        applyTheme(loadThemePreference());
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initializeThemeSwitcher);
        } else {
            initializeThemeSwitcher();
        }
    }

    // 初始化
    initialize();
})();
