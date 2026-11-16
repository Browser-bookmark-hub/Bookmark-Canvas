# Mihomo Party 预处理脚本：Edge 精准分流与低倍率代理优化指南

本文档依据 **Mihomo (Clash.Meta) 官方规则规范**，解决 **正式版 Edge 物理直连** 与 **Beta 版 / Helper (Aperitif) 走低倍率代理** 的精准分流问题。

---

## 1. 为什么用官方通配符（WILDCARD）是最精准的写法？

根据 Mihomo 官方文档（MetaCubeX Documentation），在 macOS 上，应用程序是以 `.app` 为后缀的文件夹包（Bundle），可执行文件嵌套在里面：
* **正式版路径**：`/Applications/Microsoft Edge.app/Contents/...`
* **Beta 版路径**：`/Applications/Microsoft Edge Beta.app/Contents/...`

官方支持的标准规则 `PROCESS-PATH-WILDCARD` 支持使用 `*` 通配符：
```yaml
# 正式版：命中该 .app 下的所有文件（主程序 + 所有 Helper）
PROCESS-PATH-WILDCARD,*/Microsoft Edge.app/*,DIRECT

# Beta 版：精准命中 Beta 版的 .app 目录
PROCESS-PATH-WILDCARD,*/Microsoft Edge Beta.app/*,⚡️ Edge低倍率
```
* **精准**：不用任何复杂的正则表达式（不需要 `(?i)`，不需要 `\\.` 转义）。
* **安全**：开头 `*/` 兼容 `/Applications/` 与 `~/Applications/`；结尾 `/*` 将该软件肚子里所有的主进程、Helper、Aperitif 一网打尽。
* **隔离**：正式版与 Beta 版路径完全不同，彼此 100% 隔离，绝不误伤。

---

## 2. 完整预处理脚本代码

在 Mihomo Party 中直接使用以下官方精简标准的预处理脚本：

```javascript
/**
 * 适用于 Sparkle / Mihomo Party 的预处理脚本 (官方 WILDCARD 精准版)
 */
function main(config) {
  config = config || {};

  // 1. 开启进程识别模式
  config['find-process-mode'] = 'always';

  // 2. 自动寻找当前主代理组
  const groups = Array.isArray(config['proxy-groups']) ? config['proxy-groups'] : [];
  let mainGroup = '';
  const candidate = groups.find(g => 
    /^(Hello酷狗|PROXY|节点选择|自动选择|漏网之鱼|GLOBAL|MATCH)$/i.test(g.name) ||
    g.type === 'select'
  );
  if (candidate) {
    mainGroup = candidate.name;
  }

  // 3. 智能创建「⚡️ Edge低倍率」专属策略组（自动置顶 0.x / 1x / 2x 节点）
  const edgeGroupName = '⚡️ Edge低倍率';
  let allProxyNames = [];
  if (Array.isArray(config.proxies)) {
    allProxyNames.push(...config.proxies.map(p => p.name));
  }
  if (candidate && Array.isArray(candidate.proxies)) {
    allProxyNames.push(...candidate.proxies);
  }
  allProxyNames = Array.from(new Set(allProxyNames)).filter(name => name !== 'DIRECT' && name !== 'REJECT');

  // 匹配低倍率关键字 (0.x, 1x, 2x, *1, *2)
  const lowMultiplierRegex = /(0\.[0-9]+|[1-2](\.0)?x|\*[0-2](\.[0-9]+)?|\b[0-2]x\b|倍率:?[0-2]|x[0-2](\.[0-9]+)?)/i;
  const lowMultiplierProxies = allProxyNames.filter(name => lowMultiplierRegex.test(name));

  const edgeProxiesList = Array.from(new Set([
    ...lowMultiplierProxies,
    ...(mainGroup ? [mainGroup] : []),
    ...allProxyNames,
    'DIRECT'
  ]));

  const hasEdgeGroup = groups.some(g => g.name === edgeGroupName);
  if (!hasEdgeGroup) {
    config['proxy-groups'] = [
      {
        name: edgeGroupName,
        type: 'select',
        proxies: edgeProxiesList.length > 0 ? edgeProxiesList : (mainGroup ? [mainGroup, 'DIRECT'] : ['DIRECT'])
      },
      ...groups
    ];
  }

  // 4. 国内流媒体全量域名白名单
  const domesticMediaDomains = [
    '+.bilibili.com',
    '+.bilibili.cn',
    '+.bilivideo.com',
    '+.bilivideo.cn',
    '+.hdslb.com',
    '+.biliapi.net',
    '+.szbdyd.com',
    '+.douyin.com',
    '+.douyinvod.com',
    '+.bytevcloud.com',
    '+.bytetos.com',
    '+.ibytedtos.com',
    '+.toutiaovod.com',
    '+.snssdk.com',
    '+.pstatp.com',
    '+.amemv.com',
    '+.volces.com',
    '+.byteimg.com',
    '+.qpic.cn',
    '+.qq.com',
    '+.iqiyi.com',
    '+.youku.com'
  ];

  // 5. TUN 配置
  config.tun = {
    ...(config.tun || {}),
    enable: true,
    stack: 'system',
    'endpoint-independent-nat': true,
    'auto-route': true,
    'auto-detect-interface': true,
    'strict-route': true,
    'dns-hijack': ['any:53', 'tcp://any:53']
  };

  // 6. 域名嗅探
  config.sniffer = {
    ...(config.sniffer || {}),
    enable: true,
    'force-dns-mapping': true,
    'parse-pure-ip': true,
    'override-destination': false,
    'skip-domain': domesticMediaDomains,
    sniff: {
      HTTP: { ports: [80, '8080-8880'], 'override-destination': false },
      TLS: { ports: [443, 8443] }
    }
  };

  // 7. DNS 配置
  const chinaDNS = [
    '223.5.5.5',
    '119.29.29.29',
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query'
  ];
  const foreignDNS = [
    `https://1.1.1.1/dns-query${mainGroup ? '#' + mainGroup : ''}`
  ];

  config.dns = {
    ...(config.dns || {}),
    enable: true,
    listen: '0.0.0.0:1053',
    ipv6: false,
    'cache-algorithm': 'arc',
    'prefer-h3': false,
    'use-hosts': true,
    'use-system-hosts': true,
    'respect-rules': true,
    'enhanced-mode': 'fake-ip',
    'fake-ip-filter-mode': 'blacklist',
    'fake-ip-filter': [
      '+.lan',
      '+.local',
      '+.market.xiaomi.com',
      'time.*.com',
      'ntp.*.com',
      'geosite:cn',
      ...domesticMediaDomains
    ],
    'default-nameserver': ['223.5.5.5', '119.29.29.29'],
    nameserver: foreignDNS,
    'proxy-server-nameserver': [
      'https://doh.pub/dns-query#DIRECT',
      'https://dns.alidns.com/dns-query#DIRECT'
    ],
    'direct-nameserver': chinaDNS,
    'nameserver-policy': {
      'geosite:cn,private': chinaDNS,
      'geosite:geolocation-!cn': foreignDNS,
      '+.copilot.microsoft.com': foreignDNS,
      '+.bing.com': foreignDNS,
      '+.bing.net': foreignDNS,
      '+.sydney.bing.com': foreignDNS,
      '+.edgeservices.bing.com': foreignDNS,
      '+.edge.microsoft.com': foreignDNS,
      'ecs.office.com': foreignDNS,
      'substrate.office.com': foreignDNS,
      'odc.officeapps.live.com': foreignDNS
    }
  };

  // 8. 规则列表（使用官方标准 WILDCARD，精准无冗余）
  const originalRules = Array.isArray(config.rules) ? config.rules : [];
  config.rules = [
    // 基础拦截
    'DST-PORT,853,REJECT',
    'AND,((NETWORK,UDP),(DST-PORT,443),(GEOIP,CN)),REJECT',
    'GEOSITE,private,DIRECT',
    'GEOIP,private,DIRECT,no-resolve',

    // =========================================================================
    // 【核心 1】：Microsoft Edge 正式版 100% 物理直连
    // 使用官方 PROCESS-PATH-WILDCARD 精准匹配 .app 目录下的所有主进程及 Helper 进程
    // =========================================================================
    'PROCESS-PATH-WILDCARD,*/Microsoft Edge.app/*,DIRECT',

    // =========================================================================
    // 【核心 2】：国内流媒体及常规国内网站直连
    // 确保 Edge Beta 浏览国内网站不消耗代理流量
    // =========================================================================
    'DOMAIN-SUFFIX,douyinvod.com,DIRECT',
    'DOMAIN-SUFFIX,douyin.com,DIRECT',
    'DOMAIN-SUFFIX,bytevcloud.com,DIRECT',
    'DOMAIN-SUFFIX,bytetos.com,DIRECT',
    'DOMAIN-SUFFIX,ibytedtos.com,DIRECT',
    'DOMAIN-SUFFIX,toutiaovod.com,DIRECT',
    'DOMAIN-SUFFIX,snssdk.com,DIRECT',
    'DOMAIN-SUFFIX,bilivideo.com,DIRECT',
    'DOMAIN-SUFFIX,bilibili.com,DIRECT',
    'GEOSITE,cn,DIRECT',
    'GEOIP,cn,DIRECT',

    // =========================================================================
    // 【核心 3】：Edge Beta / 侧边栏 Copilot / 判区接口 -> 专属「⚡️ Edge低倍率」组
    // =========================================================================
    // 1. Edge 官方服务及 AI 侧边栏域名
    `DOMAIN-SUFFIX,copilot.microsoft.com,${edgeGroupName}`,
    `DOMAIN-SUFFIX,sydney.bing.com,${edgeGroupName}`,
    `DOMAIN-SUFFIX,edgeservices.bing.com,${edgeGroupName}`,
    `DOMAIN-SUFFIX,edge.microsoft.com,${edgeGroupName}`,
    `DOMAIN,ecs.office.com,${edgeGroupName}`,
    `DOMAIN,substrate.office.com,${edgeGroupName}`,
    `DOMAIN,odc.officeapps.live.com,${edgeGroupName}`,
    `DOMAIN-SUFFIX,bing.com,${edgeGroupName}`,
    `DOMAIN-SUFFIX,bing.net,${edgeGroupName}`,

    // 2. Edge Beta 版所有外网流量精准分流至专属组
    `PROCESS-PATH-WILDCARD,*/Microsoft Edge Beta.app/*,${edgeGroupName}`,

    // Google 核心服务（跟随主代理）
    `GEOSITE,google,${mainGroup || 'DIRECT'}`,

    // 模拟器直连
    'PROCESS-NAME,BlueStacks,DIRECT',
    'PROCESS-NAME,qemu-system-aarch64,DIRECT',
    'PROCESS-PATH,*BlueStacks*,DIRECT',

    // 继承原有规则
    ...originalRules
  ];

  // 9. 静态绑定 DoH IP
  config.hosts = {
    ...(config.hosts || {}),
    'dns.alidns.com': ['223.5.5.5', '223.6.6.6'],
    'doh.pub': ['1.12.12.12', '120.53.53.53']
  };

  return config;
}
```
