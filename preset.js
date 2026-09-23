// 由 build_bonjourr.js 生成，请勿手改。
// 作用：在 Bonjourr 启动前同步预置设置（官方 config.json 机制在本代码路径下不生效，见构建脚本注释）。
//
// 三条设计约束（都是踩过坑才这么写的）：
//  1) 预置拆成【设置】和【快捷方式】两块，预置升级时**只动快捷方式**。
//     早先的版本是整份 localStorage.setItem(KEY, ...)，等于把老板自己调过的背景、主题、
//     搜索引擎，以及他后来自己加的快捷方式，一起冲掉。
//     现在设置（CORE）只在首次安装时写入，之后永不触碰。
//  2) 只认「自己这一批」快捷方式键：links + 4 位序号 + w8。
//     Bonjourr 自己新建的键是 links + 随机 6 位（index.ts 里 \`links${randomString(6)}\`），
//     两者形状不同，所以老板自己加的书签一律留得住。
//  3) ★ v3.19：升级改成**合并**，不再「先把自己那批全删掉、再全落一遍」。
//     老做法会把老板**特意删掉**的预置书签又装回来（他报过：删了百度、Ctrl+F5 又出现）。
//     新规则三条：① 你数据里已有的键 → 一个字都不动（连你改过的标题/网址也保住）；
//     ② 上一版预置里有、现在你数据里没有 = 你删的 → 不复活；
//     ③ 只有「本版预置新增的」才补进去。
//     代价（老板知情并拍板）：以后我们主动改某条预置书签的名字/网址，也不会再覆盖你那一份。
//     上一版的键清单存在 wei8-preset-keys；它要是丢了，退化成「一个都不补」的保守行为 ——
//     宁可不补，也绝不复活你删掉的东西。清单每次跑完都更新成「本版全部预置键」；
//     跑完什么都没变时**不写数据、不留痕**（最多只有一次，因为版本标记会跟着更新）。
//  4) 每次进本层都先看标记：标记 = 当前版本就直接 return，一次存储都不碰（正常打开的路径）。
(function () {
    var KEY = 'bonjourr';
    var MARK = 'wei8-preset-v';
    /* 上一版预置「自己那批」键清单（v3.19）。用途：升级时分辨
       「本版新增的预置项」（要补）和「你删掉的预置项」（不复活）。
       它是**我们自己的账本**，不是设置数据，所以单独一个键。 */
    var PKEYS = 'wei8-preset-keys';
    var VER = '11';
    var ALL = {"about":{"browser":"online","version":"22.3.0"},"lang":"zh-CN","tabtitle":"Wei8 导航","dateformat":"cn","announcements":"off","quicklinks":true,"time":true,"main":true,"linkgroups":{"on":true,"selected":"常用","groups":["常用","自媒体","开发工具","游戏模拟器","AI 工具","学习教育","设计工具","基金购物"],"pinned":[],"synced":[]},"searchbar":{"on":true,"newtab":false,"engine":"custom","request":"https://www.baidu.com/s?wd=%s","opacity":0.15,"suggestions":false,"placeholder":"搜索"},"quotes":{"on":true,"author":false,"type":"user","frequency":"tabs","userlist":"孔子,学而时习之，不亦说乎。\n孔子,知之者不如好之者，好之者不如乐之者。\n孔子,三人行，必有我师焉。\n孔子,君子求诸己，小人求诸人。\n《周易》,天行健，君子以自强不息。\n《周易》,地势坤，君子以厚德载物。\n孟子,天将降大任于是人也，必先苦其心志。\n孟子,生于忧患，死于安乐。\n荀子,不积跬步，无以至千里。\n荀子,锲而不舍，金石可镂。\n老子,千里之行，始于足下。\n老子,知人者智，自知者明。\n《礼记》,博学之，审问之，慎思之，明辨之，笃行之。\n《大学》,苟日新，日日新，又日新。\n屈原,路漫漫其修远兮，吾将上下而求索。\n诸葛亮,非淡泊无以明志，非宁静无以致远。\n王勃,穷且益坚，不坠青云之志。\n李白,长风破浪会有时，直挂云帆济沧海。\n刘禹锡,沉舟侧畔千帆过，病树前头万木春。\n韩愈,业精于勤，荒于嬉。\n苏轼,博观而约取，厚积而薄发。\n陆游,纸上得来终觉浅，绝知此事要躬行。\n朱熹,问渠那得清如许？为有源头活水来。\n陶渊明,盛年不重来，一日难再晨。及时当勉励，岁月不待人。\n郑板桥,咬定青山不放松，立根原在破岩中。\n《后汉书》,有志者事竟成。\n王阳明,知行合一，止于至善。\n《增广贤文》,一寸光阴一寸金，寸金难买寸光阴。\n,你若盛开，蝴蝶自来。\n,慢慢来，比较快。\n,心若向阳，无惧悲伤。\n,保持热爱，奔赴山海。\n,今天的努力，是明天的底气。\n,所有的努力都不会白费，时间会给出答案。\n,先成为自己的光，再去照亮别人。\n,成长是一场和自己的比赛。\n,认真生活的人，终会被生活温柔以待。\n,坚持的意义，是让平凡的日子闪闪发光。\n,把每一天过好，就是最好的人生。\n,你已经做得很好了，继续往前就好。\n,不必太在意别人的眼光，你只需要成为更好的自己。\n,愿你所求皆如愿，所行化坦途。"},"backgrounds":{"type":"color","frequency":"hour","fadein":600,"bright":0.8,"blur":0,"color":"#1B2A33","urls":"","images":"bonjourr-images-daylight","videos":"bonjourr-videos-daylight","mute":true,"queries":{},"texture":{"type":"none"}},"weather":{"city":"泉州","unit":"metric","show_unit":true,"geolocation":"approximate","forecast":"auto","temperature":"actual","moreinfo":"custom","provider":"https://www.qweather.com/"},"move":{"selection":"single","layouts":{"single":{"grid":[["time"],["main"],["searchbar"],["quicklinks"],["quotes"]],"items":{}},"double":{"grid":[["time","."],["main","."],["searchbar","."],["quicklinks","."],["quotes","."]],"items":{}},"triple":{"grid":[[".","time","."],[".","main","."],[".","searchbar","."],[".","quicklinks","."],[".","quotes","."]],"items":{}}}},"links0001w8":{"_id":"links0001w8","parent":"常用","order":0,"title":"百度","url":"https://www.baidu.com","icon":{"type":"url","value":"icons/baidu.com.png"}},"links0002w8":{"_id":"links0002w8","parent":"常用","order":1,"title":"抖音","url":"https://www.douyin.com","icon":{"type":"url","value":"icons/douyin.com.png"}},"links0003w8":{"_id":"links0003w8","parent":"常用","order":2,"title":"小红书","url":"https://www.xiaohongshu.com","icon":{"type":"url","value":"icons/xiaohongshu.com.png"}},"links0004w8":{"_id":"links0004w8","parent":"常用","order":3,"title":"知乎","url":"https://www.zhihu.com","icon":{"type":"url","value":"icons/zhihu.com.png"}},"links0005w8":{"_id":"links0005w8","parent":"常用","order":4,"title":"微博","url":"https://weibo.com","icon":{"type":"url","value":"icons/weibo.com.png"}},"links0006w8":{"_id":"links0006w8","parent":"常用","order":5,"title":"Gmail","url":"https://mail.google.com","icon":{"type":"url","value":"icons/mail.google.com.png"}},"links0007w8":{"_id":"links0007w8","parent":"常用","order":6,"title":"夸克网盘","url":"https://pan.quark.cn","icon":{"type":"url","value":"icons/pan.quark.cn.png"}},"links0008w8":{"_id":"links0008w8","parent":"常用","order":7,"title":"Google","url":"https://www.google.com","icon":{"type":"url","value":"icons/google.com.png"}},"links0009w8":{"_id":"links0009w8","parent":"常用","order":8,"title":"石墨","url":"https://shimo.im/desktop","icon":{"type":"url","value":"icons/shimo.im-desktop.png"}},"links0010w8":{"_id":"links0010w8","parent":"常用","order":9,"title":"一刻相册","url":"https://photo.baidu.com/photo/web/home","icon":{"type":"url","value":"icons/photo.baidu.com-photo-web-home.png"}},"links0011w8":{"_id":"links0011w8","parent":"常用","order":10,"title":"花瓣网","url":"https://huaban.com/discovery","icon":{"type":"url","value":"icons/huaban.com-discovery.png"}},"links0012w8":{"_id":"links0012w8","parent":"常用","order":11,"title":"文心助手","url":"https://chat.baidu.com/","icon":{"type":"url","value":"icons/chat.baidu.com.png"}},"links0013w8":{"_id":"links0013w8","parent":"常用","order":12,"title":"龙轩导航","url":"http://ilxdh.com","icon":{"type":"url","value":"icons/ilxdh.com.png"}},"links0014w8":{"_id":"links0014w8","parent":"常用","order":13,"title":"豆包","url":"https://www.doubao.com/chat/","icon":{"type":"url","value":"icons/doubao.com-chat.png"}},"links0015w8":{"_id":"links0015w8","parent":"常用","order":14,"title":"get笔记","url":"https://www.biji.com/","icon":{"type":"url","value":"icons/biji.com.png"}},"links0016w8":{"_id":"links0016w8","parent":"常用","order":15,"title":"飞书文档","url":"https://cls88i1wk5.feishu.cn/drive/home/","icon":{"type":"url","value":"icons/cls88i1wk5.feishu.cn-drive-home.png"}},"links0017w8":{"_id":"links0017w8","parent":"常用","order":16,"title":"办公人导航","url":"https://www.bgrdh.com/","icon":{"type":"url","value":"icons/bgrdh.com.png"}},"links0018w8":{"_id":"links0018w8","parent":"自媒体","order":17,"title":"公众号后台","url":"https://mp.weixin.qq.com","icon":{"type":"url","value":"icons/mp.weixin.qq.com.png"}},"links0019w8":{"_id":"links0019w8","parent":"自媒体","order":18,"title":"视频号","url":"https://channels.weixin.qq.com","icon":{"type":"url","value":"icons/channels.weixin.qq.com.png"}},"links0020w8":{"_id":"links0020w8","parent":"自媒体","order":19,"title":"头条号","url":"https://mp.toutiao.com","icon":{"type":"url","value":"icons/mp.toutiao.com.png"}},"links0021w8":{"_id":"links0021w8","parent":"自媒体","order":20,"title":"百家号","url":"https://baijiahao.baidu.com","icon":{"type":"url","value":"icons/baijiahao.baidu.com.png"}},"links0022w8":{"_id":"links0022w8","parent":"自媒体","order":21,"title":"B站","url":"https://www.bilibili.com","icon":{"type":"url","value":"icons/bilibili.com.png"}},"links0023w8":{"_id":"links0023w8","parent":"自媒体","order":22,"title":"抖音创作者","url":"https://creator.douyin.com","icon":{"type":"url","value":"icons/creator.douyin.com.png"}},"links0024w8":{"_id":"links0024w8","parent":"自媒体","order":23,"title":"小红书创作者","url":"https://creator.xiaohongshu.com","icon":{"type":"url","value":"icons/creator.xiaohongshu.com.png"}},"links0025w8":{"_id":"links0025w8","parent":"自媒体","order":24,"title":"快手","url":"https://www.kuaishou.cn/","icon":{"type":"url","value":"icons/kuaishou.cn.png"}},"links0026w8":{"_id":"links0026w8","parent":"自媒体","order":25,"title":"连接手机","url":"https://cloud.heytap.com/","icon":{"type":"url","value":"icons/cloud.heytap.com.png"}},"links0027w8":{"_id":"links0027w8","parent":"自媒体","order":26,"title":"小米云服务","url":"https://i.mi.com/","icon":{"type":"url","value":"icons/i.mi.com.png"}},"links0028w8":{"_id":"links0028w8","parent":"自媒体","order":27,"title":"有道云笔记","url":"https://note.youdao.com/web/","icon":{"type":"url","value":"icons/note.youdao.com-web.png"}},"links0029w8":{"_id":"links0029w8","parent":"开发工具","order":28,"title":"GitHub","url":"https://github.com/weimi95","icon":{"type":"url","value":"icons/github.com-weimi95.png"}},"links0030w8":{"_id":"links0030w8","parent":"开发工具","order":29,"title":"WorkBuddy","url":"https://www.workbuddy.cn","icon":{"type":"url","value":"icons/workbuddy.cn.svg"}},"links0031w8":{"_id":"links0031w8","parent":"开发工具","order":30,"title":"百度网盘","url":"https://pan.baidu.com","icon":{"type":"url","value":"icons/pan.baidu.com.png"}},"links0032w8":{"_id":"links0032w8","parent":"开发工具","order":31,"title":"ExifTool","url":"https://exiftool.org","icon":{"type":"url","value":"icons/exiftool.org.png"}},"links0033w8":{"_id":"links0033w8","parent":"开发工具","order":32,"title":"IP地址","url":"http://ip111.cn/","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%237D3C98%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3EIP%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0034w8":{"_id":"links0034w8","parent":"开发工具","order":33,"title":"Snapdrop","url":"https://snapdrop.net/","icon":{"type":"url","value":"icons/snapdrop.net.png"}},"links0035w8":{"_id":"links0035w8","parent":"开发工具","order":34,"title":"ip138","url":"https://ip138.com/","icon":{"type":"url","value":"icons/ip138.com.png"}},"links0036w8":{"_id":"links0036w8","parent":"开发工具","order":35,"title":"奶牛快传","url":"https://cowtransfer.com/","icon":{"type":"url","value":"icons/cowtransfer.com.png"}},"links0037w8":{"_id":"links0037w8","parent":"开发工具","order":36,"title":"阿里云盘","url":"https://www.alipan.com/drive/file/backup","icon":{"type":"url","value":"icons/alipan.com-drive-file-backup.png"}},"links0038w8":{"_id":"links0038w8","parent":"开发工具","order":37,"title":"天翼云盘","url":"https://cloud.189.cn/","icon":{"type":"url","value":"icons/cloud.189.cn.png"}},"links0039w8":{"_id":"links0039w8","parent":"开发工具","order":38,"title":"鲁大师","url":"http://www.ludashi.com/rank/cpuRanking.html","icon":{"type":"url","value":"icons/ludashi.com-rank-cpuranking.html.png"}},"links0040w8":{"_id":"links0040w8","parent":"开发工具","order":39,"title":"中国科技大学","url":"http://test.ustc.edu.cn/","icon":{"type":"url","value":"icons/test.ustc.edu.cn.png"}},"links0041w8":{"_id":"links0041w8","parent":"开发工具","order":40,"title":"Telegram","url":"https://web.telegram.org/k","icon":{"type":"url","value":"icons/web.telegram.org-k.png"}},"links0042w8":{"_id":"links0042w8","parent":"开发工具","order":41,"title":"ZeroTier","url":"https://my.zerotier.com/","icon":{"type":"url","value":"icons/my.zerotier.com.png"}},"links0043w8":{"_id":"links0043w8","parent":"开发工具","order":42,"title":"(网盘)搜索","url":"https://www.lzpanx.com/","icon":{"type":"url","value":"icons/lzpanx.com.png"}},"links0044w8":{"_id":"links0044w8","parent":"开发工具","order":43,"title":"金山文档","url":"https://www.kdocs.cn/latest","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%232471A3%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3E%E9%87%91%E5%B1%B1%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0045w8":{"_id":"links0045w8","parent":"开发工具","order":44,"title":"QQ空间","url":"https://qzone.qq.com/","icon":{"type":"url","value":"icons/qzone.qq.com.png"}},"links0046w8":{"_id":"links0046w8","parent":"开发工具","order":45,"title":"腾讯文档","url":"https://docs.qq.com/desktop/?_ppt=1","icon":{"type":"url","value":"icons/docs.qq.com-desktop.png"}},"links0047w8":{"_id":"links0047w8","parent":"开发工具","order":46,"title":"apkpure下载","url":"http://apkpure.com","icon":{"type":"url","value":"icons/apkpure.com.png"}},"links0048w8":{"_id":"links0048w8","parent":"开发工具","order":47,"title":"PairDrop","url":"https://s.appinn.com/","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%231E8449%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3EPA%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0049w8":{"_id":"links0049w8","parent":"开发工具","order":48,"title":"在线音乐","url":"https://music.cpp-prog.com/","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%235B2C6F%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3E%E5%9C%A8%E7%BA%BF%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0050w8":{"_id":"links0050w8","parent":"游戏模拟器","order":49,"title":"Ryujinx","url":"https://github.com/Ryujinx/Ryujinx","icon":{"type":"url","value":"icons/github.com-ryujinx-ryujinx.png"}},"links0051w8":{"_id":"links0051w8","parent":"游戏模拟器","order":50,"title":"Yuzu","url":"https://github.com/yuzu-emu/yuzu","icon":{"type":"url","value":"icons/github.com-yuzu-emu-yuzu.png"}},"links0052w8":{"_id":"links0052w8","parent":"游戏模拟器","order":51,"title":"Citron","url":"https://github.com/CitronEmulator/citron","icon":{"type":"url","value":"icons/github.com-citronemulator-citron.png"}},"links0053w8":{"_id":"links0053w8","parent":"游戏模拟器","order":52,"title":"Eden","url":"https://github.com/EdenEmulator/Eden","icon":{"type":"url","value":"icons/github.com-edenemulator-eden.png"}},"links0054w8":{"_id":"links0054w8","parent":"游戏模拟器","order":53,"title":"EmuSAK","url":"https://emusak.net","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%232471A3%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3EEM%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0055w8":{"_id":"links0055w8","parent":"AI 工具","order":54,"title":"ChatGPT","url":"https://chat.openai.com","icon":{"type":"url","value":"icons/chat.openai.com.svg"}},"links0056w8":{"_id":"links0056w8","parent":"AI 工具","order":55,"title":"Claude","url":"https://claude.ai","icon":{"type":"url","value":"icons/claude.ai.svg"}},"links0057w8":{"_id":"links0057w8","parent":"AI 工具","order":56,"title":"DeepSeek","url":"https://chat.deepseek.com","icon":{"type":"url","value":"icons/chat.deepseek.com.png"}},"links0058w8":{"_id":"links0058w8","parent":"AI 工具","order":57,"title":"Kimi","url":"https://kimi.moonshot.cn","icon":{"type":"url","value":"icons/kimi.moonshot.cn.png"}},"links0059w8":{"_id":"links0059w8","parent":"AI 工具","order":58,"title":"通义千问","url":"https://tongyi.aliyun.com","icon":{"type":"url","value":"icons/tongyi.aliyun.com.png"}},"links0060w8":{"_id":"links0060w8","parent":"AI 工具","order":59,"title":"文心一言","url":"https://yiyan.baidu.com","icon":{"type":"url","value":"icons/yiyan.baidu.com.png"}},"links0061w8":{"_id":"links0061w8","parent":"AI 工具","order":60,"title":"通义万相","url":"https://tongyi.aliyun.com/wanxiang/","icon":{"type":"url","value":"icons/tongyi.aliyun.com-wanxiang.png"}},"links0062w8":{"_id":"links0062w8","parent":"AI 工具","order":61,"title":"即梦","url":"https://jimeng.jianying.com/ai-tool/home","icon":{"type":"url","value":"icons/jimeng.jianying.com-ai-tool-home.png"}},"links0063w8":{"_id":"links0063w8","parent":"AI 工具","order":62,"title":"海螺","url":"https://hailuoai.com/","icon":{"type":"url","value":"icons/hailuoai.com.png"}},"links0064w8":{"_id":"links0064w8","parent":"AI 工具","order":63,"title":"微软绘图","url":"https://designer.microsoft.com/","icon":{"type":"url","value":"icons/designer.microsoft.com.png"}},"links0065w8":{"_id":"links0065w8","parent":"AI 工具","order":64,"title":"哩布AI","url":"https://www.liblib.art/","icon":{"type":"url","value":"icons/liblib.art.png"}},"links0066w8":{"_id":"links0066w8","parent":"AI 工具","order":65,"title":"稿定设计","url":"https://www.gaoding.com/","icon":{"type":"url","value":"icons/gaoding.com.png"}},"links0067w8":{"_id":"links0067w8","parent":"AI 工具","order":66,"title":"谷歌绘画AI","url":"https://labs.google/fx/zh/tools/image-fx","icon":{"type":"url","value":"icons/labs.google-fx-zh-tools-image-fx.png"}},"links0068w8":{"_id":"links0068w8","parent":"AI 工具","order":67,"title":"创客贴","url":"https://www.chuangkit.com/","icon":{"type":"url","value":"icons/chuangkit.com.png"}},"links0069w8":{"_id":"links0069w8","parent":"AI 工具","order":68,"title":"扣子空间","url":"https://space.coze.cn/","icon":{"type":"url","value":"icons/space.coze.cn.png"}},"links0070w8":{"_id":"links0070w8","parent":"AI 工具","order":69,"title":"腾讯朱雀AI检测","url":"https://matrix.tencent.com/ai-detect/","icon":{"type":"url","value":"icons/matrix.tencent.com-ai-detect.png"}},"links0071w8":{"_id":"links0071w8","parent":"AI 工具","order":70,"title":"星流Ai","url":"https://www.xingliu.art/","icon":{"type":"url","value":"icons/xingliu.art.png"}},"links0072w8":{"_id":"links0072w8","parent":"AI 工具","order":71,"title":"Z.Ai","url":"https://chatglm.cn/","icon":{"type":"url","value":"icons/chatglm.cn.png"}},"links0073w8":{"_id":"links0073w8","parent":"AI 工具","order":72,"title":"腾讯元宝","url":"https://yuanbao.tencent.com/","icon":{"type":"url","value":"icons/yuanbao.tencent.com.png"}},"links0074w8":{"_id":"links0074w8","parent":"AI 工具","order":73,"title":"Miora","url":"https://miora.design/","icon":{"type":"url","value":"icons/miora.design.png"}},"links0075w8":{"_id":"links0075w8","parent":"AI 工具","order":74,"title":"乐享知识库","url":"https://lexiangla.com/","icon":{"type":"url","value":"icons/lexiangla.com.png"}},"links0076w8":{"_id":"links0076w8","parent":"学习教育","order":75,"title":"智慧教育平台","url":"https://basic.smartedu.cn","icon":{"type":"url","value":"icons/basic.smartedu.cn.png"}},"links0077w8":{"_id":"links0077w8","parent":"学习教育","order":76,"title":"百度百科","url":"https://baike.baidu.com","icon":{"type":"url","value":"icons/baike.baidu.com.png"}},"links0078w8":{"_id":"links0078w8","parent":"设计工具","order":77,"title":"优设导航","url":"https://hao.uisdc.com/","icon":{"type":"url","value":"icons/hao.uisdc.com.png"}},"links0079w8":{"_id":"links0079w8","parent":"设计工具","order":78,"title":"堆糖","url":"http://www.duitang.com/","icon":{"type":"url","value":"icons/duitang.com.png"}},"links0080w8":{"_id":"links0080w8","parent":"设计工具","order":79,"title":"Bigjpg","url":"https://bigjpg.com","icon":{"type":"url","value":"icons/bigjpg.com.png"}},"links0081w8":{"_id":"links0081w8","parent":"设计工具","order":80,"title":"Vega AI 创作平台","url":"https://rightbrain.art/text2Image","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%231F618D%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3EVE%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0082w8":{"_id":"links0082w8","parent":"设计工具","order":81,"title":"美图设计","url":"https://www.designkit.com/","icon":{"type":"url","value":"icons/designkit.com.png"}},"links0083w8":{"_id":"links0083w8","parent":"设计工具","order":82,"title":"字体识别","url":"https://fontmeme.com/zh/","icon":{"type":"url","value":"icons/fontmeme.com-zh.png"}},"links0084w8":{"_id":"links0084w8","parent":"设计工具","order":83,"title":"超能画布","url":"https://photo.baidu.com/photasy/home","icon":{"type":"url","value":"icons/photo.baidu.com-photasy-home.png"}},"links0085w8":{"_id":"links0085w8","parent":"设计工具","order":84,"title":"鞋AI","url":"https://aigc.valimart.net/","icon":{"type":"url","value":"icons/aigc.valimart.net.png"}},"links0086w8":{"_id":"links0086w8","parent":"设计工具","order":85,"title":"在线字体","url":"http://www.akuziti.com/","icon":{"type":"url","value":"icons/akuziti.com.png"}},"links0087w8":{"_id":"links0087w8","parent":"设计工具","order":86,"title":"奇迹色彩","url":"https://www.qijishow.com/Colors/pick.html","icon":{"type":"url","value":"icons/qijishow.com-colors-pick.html.png"}},"links0088w8":{"_id":"links0088w8","parent":"设计工具","order":87,"title":"神彩AI","url":"https://www.ishencai.com/blender","icon":{"type":"url","value":"icons/ishencai.com-blender.png"}},"links0089w8":{"_id":"links0089w8","parent":"设计工具","order":88,"title":"商标库","url":"https://www.tmkoo.com/","icon":{"type":"url","value":"icons/tmkoo.com.png"}},"links0090w8":{"_id":"links0090w8","parent":"设计工具","order":89,"title":"壁纸样机","url":"https://mjcn.club/app/","icon":{"type":"url","value":"icons/mjcn.club-app.png"}},"links0091w8":{"_id":"links0091w8","parent":"设计工具","order":90,"title":"无水印解析下载","url":"https://www.xiazaitool.com/","icon":{"type":"url","value":"icons/xiazaitool.com.png"}},"links0092w8":{"_id":"links0092w8","parent":"设计工具","order":91,"title":"pexels 无版权视频库","url":"https://www.pexels.com/zh-cn/videos/","icon":{"type":"url","value":"icons/pexels.com-zh-cn-videos.png"}},"links0093w8":{"_id":"links0093w8","parent":"设计工具","order":92,"title":"pixabay 无版权视频","url":"https://pixabay.com/videos/","icon":{"type":"url","value":"icons/pixabay.com-videos.png"}},"links0094w8":{"_id":"links0094w8","parent":"设计工具","order":93,"title":"图片取色器","url":"https://free-for-dev.com/tools/image/color-extractor","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%23A93226%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3E%E5%9B%BE%E7%89%87%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0095w8":{"_id":"links0095w8","parent":"设计工具","order":94,"title":"锤子图片取色","url":"https://www.toolhelper.cn/Color/PickImageColor#42b983","icon":{"type":"url","value":"icons/toolhelper.cn-color-pickimagecolor.png"}},"links0096w8":{"_id":"links0096w8","parent":"设计工具","order":95,"title":"字体天下","url":"https://www.fonts.net.cn/","icon":{"type":"url","value":"icons/fonts.net.cn.png"}},"links0097w8":{"_id":"links0097w8","parent":"设计工具","order":96,"title":"识字体","url":"https://www.likefont.com/","icon":{"type":"url","value":"icons/likefont.com.png"}},"links0098w8":{"_id":"links0098w8","parent":"设计工具","order":97,"title":"商标查询","url":"https://tm.aliyun.com/","icon":{"type":"url","value":"icons/tm.aliyun.com.png"}},"links0099w8":{"_id":"links0099w8","parent":"基金购物","order":98,"title":"基金行情预估","url":"http://fund.furion.top:81/login","icon":{"type":"url","value":"data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Ccircle%20cx%3D%2232%22%20cy%3D%2232%22%20r%3D%2232%22%20fill%3D%22%23148F77%22%2F%3E%3Ctext%20x%3D%2232%22%20y%3D%2233%22%20text-anchor%3D%22middle%22%20dominant-baseline%3D%22central%22%20font-family%3D%22system-ui%2C-apple-system%2CSegoe%20UI%2CMicrosoft%20YaHei%2Csans-serif%22%20font-size%3D%2222%22%20font-weight%3D%22500%22%20fill%3D%22%23ffffff%22%3E%E5%9F%BA%E9%87%91%3C%2Ftext%3E%3C%2Fsvg%3E"}},"links0100w8":{"_id":"links0100w8","parent":"基金购物","order":99,"title":"A股指数","url":"http://quote.eastmoney.com/zs000002.html","icon":{"type":"url","value":"icons/quote.eastmoney.com-zs000002.html.png"}},"links0101w8":{"_id":"links0101w8","parent":"基金购物","order":100,"title":"积少成多","url":"https://qieman.com/portfolios/SI000014/research","icon":{"type":"url","value":"icons/qieman.com-portfolios-si000014-research.png"}},"links0102w8":{"_id":"links0102w8","parent":"基金购物","order":101,"title":"沪深300温度","url":"https://youzhiyouxing.cn/data/indices/000300.SH","icon":{"type":"url","value":"icons/youzhiyouxing.cn-data-indices-000300.sh.png"}},"links0103w8":{"_id":"links0103w8","parent":"基金购物","order":102,"title":"上证指数(000001)","url":"http://quote.eastmoney.com/zs000001.html","icon":{"type":"url","value":"icons/quote.eastmoney.com-zs000001.html.png"}},"links0104w8":{"_id":"links0104w8","parent":"基金购物","order":103,"title":"大盘云图","url":"https://summary.jrj.com.cn/dataCenter/dpyt/","icon":{"type":"url","value":"icons/summary.jrj.com.cn-datacenter-dpyt.png"}},"links0105w8":{"_id":"links0105w8","parent":"基金购物","order":104,"title":"什么值得买","url":"https://www.smzdm.com/","icon":{"type":"url","value":"icons/smzdm.com.png"}},"links0106w8":{"_id":"links0106w8","parent":"基金购物","order":105,"title":"淘宝网","url":"https://www.taobao.com/","icon":{"type":"url","value":"icons/taobao.com.png"}}};
    var MINE = /^links\d{4}w8$/;

    var LINKS = {};
    var CORE = {};
    /* 规范化签名：递归排序对象键后再序列化。
       直接 JSON.stringify 比会因「键的插入顺序」不同而误判 —— 数据在 localStorage 里
       来回过一遍上下游之后，键序不一定和我们写入时一致。误判的代价是把一次正常升级
       标成「版本标记丢失」，那会让老板照着留痕去查一个不存在的问题。 */
    function sig(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v);
        if (Array.isArray(v)) return '[' + v.map(sig).join(',') + ']';
        return '{' + Object.keys(v).sort().map(function (k) {
            return JSON.stringify(k) + ':' + sig(v[k]);
        }).join(',') + '}';
    }
    // 数据本体写入留痕（v3.17）：我们自己的层共 6 处会写 localStorage['bonjourr']，本层占 1 处。
    // 写完往独立小键 wei8-writes 记一条（最近 10 条，新→旧），自检页 wei8-diag.html 会展示，
    // 用来回答「每次打开又变回默认」到底是不是有层在开机时重写了数据、是哪一层。
    // 刻意不抽公共文件：本层要在 main.js 之前跑，不能有任何加载依赖。
    // v3.19：加 once 参数（「同一条标签连着记就不重复」）。标记写不住时本层每次打开都会进来，
    //   那种情况下的记录只看第一条就够，否则 10 条环形缓冲会被同一条刷满、把别的证据挤掉。
    function logWrite(by, once) {
        try {
            var L = JSON.parse(localStorage.getItem('wei8-writes') || '[]');
            if (!Array.isArray(L)) L = [];
            if (once && L.length && L[0] && L[0].by === by) return;
            L.unshift({ at: new Date().toISOString(), by: by });
            localStorage.setItem('wei8-writes', JSON.stringify(L.slice(0, 10)));
        } catch (e) { /* 留痕失败不影响预置 */ }
    }
    Object.keys(ALL).forEach(function (k) {
        // linkgroups（有哪些组、组顺序）跟快捷方式是一体的，必须跟它一起更新
        if (MINE.test(k) || k === 'linkgroups') LINKS[k] = ALL[k];
        else CORE[k] = ALL[k];
    });

    /* ★ v3.20：翻译词条的缓存过期清理（必须在下面那个 return 之前跑 —— 标记最新时本层会提前
       返回，而这个校验每次打开都要看一眼）。
       病灶（读到上游源码才确认）：main.js:2015 setTranslationCache() 把整份词条缓存在
       localStorage['translations']，判据只有「缓存里的 lang === 当前语言码」——相同就直接用缓存，
       **一次请求都不发**。所以给翻译 URL 挂内容哈希只能修 SW 那一层，修不了这里：
       老板机器上那份缓存是改名之前留下的，于是「得到 / 发送」怎么都改不掉。
       写法上刻意**不设「本版已迁移过」的短路标记**：迁移那次万一恰好离线（SW 的断网兜底会
       忽略查询串把旧的 translations.json 端回来），带短路的版本会把旧词条连标记一起写死，
       以后再也不会重试 —— 变成「一次离线，永久卡住」。所以判据只认**内容本身**：
         · 快路径：整串里直接找 "Get":"下载还原" / "Send":"上传备份"（JSON.stringify 不产生空格，
           所以字面量能找到就是对的）→ 两个都找到就一个字节不动，连 JSON.parse 都不做；
         · 找不到才解析，逐键比对；对不上就整份删掉，让随后运行的 main.js 重新拉一份。
       缓存压根不存在也视为通过 —— 那种情况 main.js 本来就会去拉新的。
       wei8-tr-v 只留下一枚「上次校验通过的哈希」，给自检页看，不参与任何判断。
       注意：这里只动缓存键，**不写 wei8-writes** —— 那张表是「设置数据本体」的写入台账，
       混进缓存清理会让老板查问题时分不清哪条是数据被改、哪条只是清缓存。 */
    var TRN_VER = '2f5feaf4';
    var TRN_FIX = {"Get":"下载还原","Send":"上传备份"};
    var TRN_STAMP = 'wei8-tr-v';
    try {
        var trRaw = localStorage.getItem('translations');
        if (trRaw !== null && trRaw !== '') {
            var trHit = true;
            Object.keys(TRN_FIX).forEach(function (k) {
                if (trRaw.indexOf('"' + k + '":"' + TRN_FIX[k] + '"') === -1) trHit = false;
            });
            if (!trHit) {
                var trObj = null;
                try { trObj = JSON.parse(trRaw); } catch (e) { trObj = null; }
                var trStale = !trObj || typeof trObj !== 'object' || Array.isArray(trObj);
                if (!trStale) {
                    Object.keys(TRN_FIX).forEach(function (k) {
                        if (trObj[k] !== TRN_FIX[k]) trStale = true;
                    });
                }
                if (trStale) localStorage.removeItem('translations');
            }
        }
        localStorage.setItem(TRN_STAMP, TRN_VER);
    } catch (e) { /* 读不了就算了：最坏是继续用旧词条，页面功能不受影响 */ }

    try {
        if (localStorage.getItem(MARK) === VER) return;
        /* ★ 判据（v3.18）：能走到这里说明标记 ≠ 当前版本。要分清是「正常换版」还是「标记丢失」：
             · 标记不存在 + 数据存在 → ★★ 标记丢了。本层每次成功跑完都会写标记，
               所以「有数据却没标记」只可能是标记被清/没写住 → 于是每次打开都重跑升级
               → 老板删掉的预置书签（百度等）会被反复装回来。这条必须点名。
             · 标记存在但是别的值 → 正常换版（我们把 VER 从 N 提到 N+1）。 */
        var prevMark = localStorage.getItem(MARK);
        var markMissing = prevMark === null || prevMark === '';

        var raw = localStorage.getItem(KEY);
        var cur = null;
        var damaged = '';
        if (raw !== null && raw !== '') {
            try { cur = JSON.parse(raw); } catch (e) { cur = null; }
            if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) {
                /* v3.18 堵洞：上游 localSet() 会把 undefined 写成字符串 "undefined" 落进 localStorage
                   （sync-patch 的 cleanDirty 就是为这个才存在的）。老代码在这条路上会走「升级」分支、
                   cur 变成 {} —— 结果是老板的背景/主题/引擎/时钟/天气/布局全回 Bonjourr 内置默认，
                   而留痕还写着「preset·更新快捷方式」，看着像一次正常升级。症状与
                   「打开又变回默认」一模一样，却查不出原因。现在：损坏值一律按首次安装处理，
                   并且把「损坏」这件事明写进留痕。 */
                damaged = '旧值不是合法 JSON：' + String(raw).slice(0, 12) + '…';
                cur = null;
            }
        }
        var fresh = cur === null;

        /* ★ v3.19：合并式升级。老做法是「先 delete 掉自己那批、再整批写回」，于是老板
           **特意删掉**的预置书签每次换版都会复活（他报的现象：首页删了百度，Ctrl+F5 又出现）。
           新规则三条：① 你数据里已有的键 → 一个字都不动（连你改过的标题/网址也保住）；
                     ② 上一版清单里有、你数据里没有 = 你删的 → 不复活；
                     ③ 只有「本版新增的」才补进去。
           判据全靠上一版清单 wei8-preset-keys；清单丢了就分不清 ② 和 ③ → 一个都不补。 */
        var snapshot = null;
        var snapRaw = localStorage.getItem(PKEYS);
        if (snapRaw !== null && snapRaw !== '') {
            try {
                var pv = JSON.parse(snapRaw);
                if (Array.isArray(pv)) snapshot = pv;
            } catch (e) { snapshot = null; }
        }
        var snapLost = false;
        if (snapshot === null) {
            /* 清单丢了。此时「本版新增」和「你删掉的」在数据里长得一模一样 ——
               保守起见**一条都不补**：宁可漏掉一条新书签，也绝不把老板删掉的东西装回去。
               ★ 坑：不能只是把 snapshot 置成空数组就算了 —— 那样所有缺失的键都会被判成
               「不在清单里 = 本版新增」，于是 106 条全被补回来，正好是我们要防的事。
               所以另用一个 snapLost 标志在下面短路（verify 里「清单丢失」那三条就是守它的）。
               首装（fresh）不需要判据：所有键都照装，故 snapLost 恒为 false。 */
            snapshot = [];
            snapLost = !fresh;
        }

        var added = [];   // 本次补进去的（只可能是本版新增）
        var keptOut = 0;  // 你删掉的、本次刻意没补的
        var edited = 0;   // 你改过的、本次刻意没覆盖的
        if (fresh) {
            cur = {};
            Object.keys(CORE).forEach(function (k) { cur[k] = CORE[k]; });
        }
        Object.keys(LINKS).forEach(function (k) {
            if (k === 'linkgroups') return;   // 组配置单独处理，见下
            if (Object.prototype.hasOwnProperty.call(cur, k)) {
                if (MINE.test(k) && sig(cur[k]) !== sig(LINKS[k])) edited++;
                return;                        // ① 已有 → 一个字都不动
            }
            if (snapLost) return;              // 清单不明 → 分不清 ②③ → 一条都不补
            if (snapshot.indexOf(k) > -1) { keptOut++; return; }   // ② 你删的 → 不复活
            cur[k] = LINKS[k];                                     // ③ 本版新增 → 补
            added.push(k);
        });

        /* linkgroups（有哪些组、组顺序）：你已有的不动（你可能自己加过组、调过顺序），
           只在缺失时补整份，以及把「本次新补的书签」所属的组名追加进去 ——
           否则新书签的 parent 指向一个不存在的组，等于白补。 */
        var lgTouched = false;
        if (fresh || !cur.linkgroups || typeof cur.linkgroups !== 'object') {
            cur.linkgroups = LINKS.linkgroups;
            lgTouched = true;
        } else if (added.length) {
            var lnames = Array.isArray(cur.linkgroups.groups) ? cur.linkgroups.groups.slice() : [];
            added.forEach(function (k) {
                var p = LINKS[k] && LINKS[k].parent;
                if (p && lnames.indexOf(p) === -1) { lnames.push(p); lgTouched = true; }
            });
            if (lgTouched) cur.linkgroups.groups = lnames;
        }

        var linkN = 0;
        Object.keys(LINKS).forEach(function (k) { if (MINE.test(k)) linkN++; });

        /* 只在真有变化时写数据本体。这一条很重要：标记写不住时本层每次打开都会走到这里，
           要是无条件写一遍，留痕就会被「其实什么都没改」的记录刷满。 */
        var wrote = fresh || added.length > 0 || lgTouched;
        if (wrote) localStorage.setItem(KEY, JSON.stringify(cur));

        /* 清单每次都更新成「本版全部预置键」，这样下一版才分得清什么是新增的。
           ★ 注意 snapLost 时也照这样写，不能改成「只记实际补进去的」——
           那样下次升级会把本次漏掉的那些当成「新增」补回来，绕个圈子把你删掉的书签复活。 */
        try { localStorage.setItem(PKEYS, JSON.stringify(Object.keys(LINKS))); } catch (e3) {}

        if (fresh) {
            logWrite(damaged
                ? '⚠ preset·数据本体损坏（' + damaged + '），已按首次安装重写 ' + linkN + ' 条快捷方式'
                : 'preset·首次安装（' + linkN + ' 条快捷方式 + 整份预置设置）');
        } else if (wrote) {
            var bits = [];
            if (added.length) bits.push('补 ' + added.length + ' 条新增'
                + (added.length <= 3 ? '（' + added.join('、') + '）' : ''));
            if (lgTouched) bits.push('分组信息已更新');
            if (edited) bits.push('你改过的 ' + edited + ' 条原样保留');
            if (keptOut) bits.push('你删掉的 ' + keptOut + ' 条刻意不补');
            logWrite('preset·合并更新（' + bits.join('；') + '）', 1);
        } else if (snapLost) {
            logWrite('preset·预置键清单缺失：本次只写清单、一条书签都不补（'
                + '分不清「新预置」和「你删的」，宁可不补也不复活）', 1);
        } else if (markMissing) {
            logWrite('★★ preset·版本标记丢失：本层每次打开都会白跑一遍；'
                + '但已改成合并更新 —— 数据本体一个字都没动，你删掉的预置书签不会再回来', 1);
        }
        /* 剩下的情况 = 正常换版但确实无事可做（清单一致、没有新增、分组也没变）：
           故意不留痕。版本标记仍会更新，所以只可能发生这一次。 */
        // 同步类型预置为 gist：打开设置即可直接填 token，无需先在下拉框里选「Github Gist」。
        // 依据：synchronization/index.ts:193-217 的 switch(type) 决定是否展开 #gist-sync 区块。
        // 该键只影响设置面板展示，不改变存储后端（storageTypeFn().init() 只看 chrome.storage 是否存在）。
        localStorage.setItem('syncType', 'gist');
        /* v3.18：MARK 单独包 try。老代码里它和上面共用一个大 try —— 一旦前面任何一步抛错，
           MARK 就永远写不上，于是本层每次打开都重跑升级。那种失败过去完全无声，
           现在至少留一条痕（能写就能看到，写不了也没别的办法）。 */
        try {
            localStorage.setItem(MARK, VER);
        } catch (e2) {
            logWrite('★★ preset·版本标记写入失败 —— 下次打开会重跑升级（预置书签会被装回来）');
        }
    } catch (e) {
        /* localStorage 不可写时静默跳过，Bonjourr 会回落到内置默认值 */
    }
})();
