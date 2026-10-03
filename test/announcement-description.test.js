import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enrichEventDescription,
  enrichEventWithMetadata,
  extractAnnouncementMetadata,
  extractPostText,
  isDescriptionResource
} from '../scripts/crawler-rules.js';

const anniversaryOps = [
  { insert: '旅行者好呀！\n' },
  { insert: '现在，' },
  { insert: '最好的伙伴邀请你参与【周年拾光册】网页活动，', attributes: { bold: true } },
  { insert: '一起回顾旅行中的精彩瞬间！\n' },
  { insert: { image: 'https://example.com/cover.png' } },
  { insert: '\n【活动时间】\n2026/09/28 00:00-2026/10/18 23:59\n' },
  { insert: '与派蒙一起回顾旅程精彩经历，' },
  { insert: '前往星旅鉴语测一测你的冒险风格', attributes: { link: 'https://example.com/event' } },
  { insert: '，还可以获得' },
  { insert: '原石*180、大英雄的经验、祝圣油膏', attributes: { color: '#f00' } },
  { insert: '等奖励~\n【注意事项】\n' },
  { insert: '为确保奖励正常发放，请先绑定游戏角色。\n奖品发放时长为30个工作日。\n' }
];
const anniversaryText = extractPostText({ structured_content: JSON.stringify(anniversaryOps) });

test('Quill keeps inline formatting fragments joined and original paragraph boundaries', () => {
  assert.match(anniversaryText, /现在，最好的伙伴邀请你参与/);
  assert.match(anniversaryText, /冒险风格，还可以获得原石\*180/);
  assert.match(anniversaryText, /精彩瞬间！\n\n【活动时间】/);
  assert.equal(extractPostText({ structured_content: { ops: anniversaryOps } }), anniversaryText);
  assert.equal(extractPostText({ structured_content: JSON.stringify({ ops: anniversaryOps }) }), anniversaryText);
  assert.equal(extractPostText({ structured_content: [{ insert: '回顾' }, { insert: { image: 'x' } }, { insert: '旅程\n' }] }), '回顾旅程');
});

test('anniversary extracts gameplay and rewards after the activity dates', () => {
  const metadata = extractAnnouncementMetadata(anniversaryText);
  assert.match(metadata.description, /回顾旅程精彩经历/);
  assert.match(metadata.description, /测一测你的冒险风格/);
  assert.match(metadata.description, /原石\*180/);
  assert.doesNotMatch(metadata.description, /旅行者好呀|绑定|发放|2026/);
  assert.match(metadata.reward, /原石\*180/);
  assert.doesNotMatch(metadata.reward, /绑定|发放|30/);
  assert.equal(metadata.startDate, '2026.09.28');
  assert.equal(metadata.endDate, '2026.10.18');
  assert.ok(metadata.description.length <= 280);
});

test('HTML preserves paragraph and inline text while removing scripts, styles and comments', () => {
  const text = extractPostText({
    structured_content: 'invalid json',
    content: '<style>.hidden { display:none }</style><!-- 获得999原石 -->' +
      '<h2>活动内容</h2><p>与派蒙一起<span>回顾旅程</span>。</p><div>完成任务<br>即可获得原石&#42;180。</div>' +
      '<ul><li>分享冒险风格。</li><li>领取纪念卡。</li></ul><script>获得9999原石</script>'
  });
  assert.match(text, /活动内容\n+与派蒙一起回顾旅程。\n+完成任务\n即可获得原石\*180。/);
  assert.match(text, /分享冒险风格。\n+领取纪念卡。/);
  assert.doesNotMatch(text, /999|display:none/);
});

test('greetings are removed without discarding facts in the same sentence', () => {
  const metadata = extractAnnouncementMetadata('亲爱的绳匠，《绝区零》3.1版本预约活动现已开启，完成预约即可获得160菲林！');
  assert.equal(metadata.version, 'v3.1');
  assert.match(metadata.description, /绝区零.*完成预约即可获得160菲林/);
  assert.doesNotMatch(metadata.description, /亲爱的|绳匠/);
});

test('greetings, repeated titles, navigation and disclaimer-only announcements have no description', () => {
  for (const text of [
    '旅行者好呀！\n祝大家今天开心，明天也开心！',
    '各位奇匠，大家好！\n【活动时间】\n2026/09/28-2026/10/18',
    '开拓者们，你们好！\n点击参与活动：https://example.com/event',
    '亲爱的舰长：\n【注意事项】\n奖励将在30个工作日内发放，未绑定角色将无法获得奖励。',
    '绳匠们，大家好！\n免责声明：活动最终解释权归官方所有。'
  ]) {
    assert.equal(extractAnnouncementMetadata(text).description, undefined, text);
  }
  assert.equal(extractAnnouncementMetadata('周年拾光册网页活动正式开启！', { title: '周年拾光册网页活动正式开启' }).description, undefined);
  assert.equal(extractAnnouncementMetadata('旅行者好呀！\n「周年拾光册」网页活动正式开启！').description, undefined);
  assert.equal(extractAnnouncementMetadata('邀请你参与「周年拾光册」网页活动！\n网页活动已经上线啦！').description, undefined);
  assert.equal(extractAnnouncementMetadata('参与活动即视为同意用户协议并获得抽奖资格。').description, undefined);
});

test('reward extraction does not infer reward amounts or collect delivery instructions', () => {
  const metadata = extractAnnouncementMetadata('完成活动任务即可获得原石等奖励。\n为确保奖励发放，请绑定角色。\n奖品发放时长为30个工作日。');
  assert.equal(metadata.reward, '完成活动任务即可获得原石等奖励');
  assert.doesNotMatch(metadata.description, /180|30|发放|绑定/);
});

test('activity rule sections keep gameplay while notes remain excluded', () => {
  const metadata = extractAnnouncementMetadata('【活动规则】\n完成旅行问答，测一测你的冒险风格。\n【注意事项】\n活动中分享个人联系方式视为违规。\n【活动奖励】\n完成全部任务即可获得原石等奖励。');
  assert.match(metadata.description, /旅行问答/);
  assert.match(metadata.description, /获得原石/);
  assert.doesNotMatch(metadata.description, /联系方式/);
});

test('decorated web-event headings exclude titles and the following notice conditions', () => {
  const metadata = extractAnnouncementMetadata('旅行者好呀！\n〓网页活动时间〓\n2026/09/28-2026/10/18\n〓网页活动参与方式〓\n与派蒙一起回顾旅程，测一测你的冒险风格。\n〓网页活动奖励〓\n完成活动任务即可获得原石*180等奖励。\n〓注意事项〓\n仅冒险等阶达到10级的旅行者才可以完成挑战。\n挑战任务奖励将在30个工作日内发放。');
  assert.match(metadata.description, /冒险风格/);
  assert.match(metadata.description, /原石\*180/);
  assert.doesNotMatch(metadata.description, /〓|活动时间|活动奖励|参与方式|10级|30|发放/);
  assert.equal(metadata.reward, '完成活动任务即可获得原石*180等奖励');
  assert.equal(metadata.startDate, '2026.09.28');
  assert.equal(metadata.endDate, '2026.10.18');
});

test('generic decorated section headings are omitted while same-line reward facts remain', () => {
  const text = '完成活动任务，分享你的冒险故事。\n----投稿评选奖励----\n——参赛获奖说明——\n***活动奖品奖励***\n' +
    '活动奖励：原石x160\n参与活动即可获得原石x160等奖励。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /分享你的冒险故事/);
  assert.match(metadata.description, /原石x160/);
  assert.doesNotMatch(metadata.description, /投稿评选奖励|参赛获奖说明|活动奖品奖励|----|——|\*\*\*/);
  assert.match(metadata.reward, /活动奖励：原石x160/);
  assert.doesNotMatch(metadata.reward, /投稿评选奖励|参赛获奖说明|活动奖品奖励/);
});

test('navigation with a missing link object is omitted and trailing punctuation is cleaned', () => {
  const text = '活动期间，完成活动任务即可获得限量菲林礼包兑换码奖励；\n' +
    '获得兑换码后，绳匠可点击。\n参与活动后可前往，\n完成任务后可进入！\n领取奖励后可查看~\n' +
    '前往活动页面完成音乐任务，领取限量奖励，\n完成挑战后可以查看自己的活动记录。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /菲林礼包兑换码奖励。/);
  assert.match(metadata.description, /前往活动页面完成音乐任务，领取限量奖励。/);
  assert.doesNotMatch(metadata.description, /绳匠可点击|活动后可前往|任务后可进入|奖励后可查看|[；，]。/);
  assert.doesNotMatch(metadata.reward, /绳匠可点击|[；，]$/);
  const fullObject = extractAnnouncementMetadata('完成挑战后可以查看自己的活动记录。');
  assert.equal(fullObject.description, '完成挑战后可以查看自己的活动记录。');
});

test('watch and view buttons are excluded while complete program activities remain', () => {
  const text = '参与4.5版本前瞻特别节目互动，完成问答即可获得星琼奖励。\n点击观看4.5版本前瞻特别节目<<\n点此查看完整活动页面>>';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /参与4.5版本前瞻特别节目互动/);
  assert.doesNotMatch(metadata.description, /点击观看|点此查看|<<|>>/);
});

test('award announcement and shipping instructions are not prize facts', () => {
  const text = '完成活动任务，分享你的冒险故事。\n参与活动即可获得原石等奖励。\n' +
    '10月16日，获奖名单将在审核结束后的10个工作日内公布，请获奖的旅行者在收到私信后提交奖品收货信息（姓名、收货地址、手机号），逾期视为自动放弃奖励。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /获得原石/);
  assert.doesNotMatch(metadata.description, /获奖名单|工作日|收货|手机号|自动放弃/);
  assert.equal(metadata.reward, '参与活动即可获得原石等奖励');
});

test('agreement and privacy resources preserve their descriptions and provenance', () => {
  for (const event of [
    { title: '千星奇域创作者中心服务协议', description: '原有服务协议说明' },
    { title: '用户协议', description: '米游社官方网页活动。' },
    { title: '活动页面', sourcePostTitle: '隐私政策', description: '' },
    { url: 'https://example.com/agreement/index.html', description: '原有说明', descriptionSource: 'page' },
    { url: 'https://example.com/ys/privacy-policy.html', descriptionSource: 'announcement' },
    { url: 'https://example.com/terms', description: '' }
  ]) {
    assert.equal(isDescriptionResource(event), true);
    assert.deepEqual(enrichEventDescription(event, anniversaryText), { event, changed: false });
    const enriched = enrichEventWithMetadata(event, { description: '完成周年活动任务即可获得原石奖励。' });
    assert.equal(enriched.changed, false);
    assert.deepEqual(enriched.event, event);
  }
  assert.equal(isDescriptionResource({ title: '周年拾光册', url: 'https://example.com/event/index.html' }), false);
});

test('three detailed activity sentences still leave room for an explicit reward sentence', () => {
  const metadata = extractAnnouncementMetadata('回顾旅程精彩经历。完成旅行问答了解你的冒险风格。分享纪念卡片邀请好友参与。参与活动即可获得原石等奖励。');
  assert.match(metadata.description, /回顾旅程/);
  assert.match(metadata.description, /冒险风格/);
  assert.match(metadata.description, /获得原石/);
});

test('description chooses details before generic launch copy and caps at full sentences', () => {
  const launchCopy = '周年拾光册网页活动正式开启。';
  const gameplay = '完成旅行问答，测一测你的冒险风格。';
  const reward = '完成活动任务即可获得原石等奖励。';
  const text = launchCopy + '\n' + '精彩故事'.repeat(100) + '。\n' + gameplay + reward;
  const description = extractAnnouncementMetadata(text).description;
  assert.match(description, /完成旅行问答/);
  assert.match(description, /获得原石/);
  assert.ok(description.length <= 280);
  assert.ok(description.endsWith('。'));
  assert.doesNotMatch(description, /精彩故事/);
});

test('legacy extraction proof repairs greetings and inline fragments without changing other event fields', () => {
  const legacyText = anniversaryOps.map(op => typeof op.insert === 'string' ? op.insert : '').filter(Boolean).join('\n').trim();
  const oldDescription = legacyText.split(/\n+/).map(line => line.trim()).find(line => line.length >= 12 && !/^【.+】$/.test(line));
  const event = {
    id: 'anniversary', title: '周年拾光册', description: oldDescription,
    reward: '人工奖励文本', startDate: '2026.09.29', endDate: '2026.10.17',
    version: 'v6.0', tags: ['年度报告'], extra: { keep: true }
  };
  const result = enrichEventDescription(event, anniversaryText, { legacyText });
  assert.equal(result.changed, true);
  assert.equal(result.event.descriptionSource, 'announcement');
  assert.match(result.event.description, /冒险风格/);
  assert.deepEqual(
    Object.fromEntries(Object.entries(result.event).filter(([key]) => !['description', 'descriptionSource'].includes(key))),
    Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'description'))
  );
  assert.equal(event.description, oldDescription);
});

test('manual and unmarked custom descriptions are preserved with no provenance added', () => {
  for (const event of [
    { title: '周年拾光册', description: '旅行者好呀！', descriptionSource: 'manual' },
    { title: '周年拾光册', description: '查看周年旅行档案，了解自己的冒险风格，并领取纪念奖励。' }
  ]) {
    const result = enrichEventDescription(event, anniversaryText);
    assert.equal(result.changed, false);
    assert.equal(result.event, event);
  }
});

test('empty, generic, and explicitly automatic descriptions can be updated', () => {
  for (const event of [
    { description: '' },
    { description: '米游社官方网页活动。' },
    { description: '旅行者好呀！', descriptionSource: 'announcement' },
    { description: '周年活动页面', descriptionSource: 'page' }
  ]) {
    const result = enrichEventDescription(event, anniversaryText);
    assert.equal(result.changed, true);
    assert.equal(result.event.descriptionSource, 'announcement');
    assert.match(result.event.description, /原石\*180/);
  }
});

test('unchanged useful text and fact-free posts do not add fields', () => {
  const description = extractAnnouncementMetadata(anniversaryText).description;
  const current = { description };
  assert.deepEqual(enrichEventDescription(current, anniversaryText), { event: current, changed: false });
  const empty = { id: 'empty' };
  assert.deepEqual(enrichEventDescription(empty, '旅行者好呀！'), { event: empty, changed: false });
});

test('metadata enrichment protects manual descriptions and labels actual automatic writes', () => {
  const metadata = extractAnnouncementMetadata(anniversaryText);
  for (const description of ['', '米游社官方网页活动。']) {
    const event = { description, descriptionSource: 'manual' };
    const result = enrichEventWithMetadata(event, metadata);
    assert.equal(result.event.description, description);
    assert.equal(result.event.descriptionSource, 'manual');
    assert.equal(result.event.startDate, '2026.09.28');
  }
  const added = enrichEventWithMetadata({}, metadata);
  assert.equal(added.event.descriptionSource, 'announcement');
  const preserved = enrichEventWithMetadata({ description: '自定义的周年旅行档案介绍，回顾已经完成的冒险。' }, metadata);
  assert.equal(preserved.event.descriptionSource, undefined);
});

// Short public-announcement excerpts retain the original wording and structure.
test('drawing submission announcement omits launch title, schedule and lengthy reward delivery copy', () => {
  const text = '开拓者好呀~\n「知更鸟•晴歌」主题绘画征集活动现已开启！\n' +
    '投稿征集阶段：2026年8月19日 - 2026年9月9日 23:59\n' +
    '1、活动期间，在上方指定活动页面点击“参与投稿”按钮，发布符合投稿要求的「知更鸟•晴歌」同人绘画作品，或选择符合投稿要求的历史作品来关联活动，均视为参与成功。\n' +
    '2、未通过指定页面投稿且已发布的米游社作品，也可以通过编辑帖子-选择”参与话题“-选择“知更鸟•晴歌绘画”来关联本活动（需更新至米游社App最新版本）。\n' +
    '※开拓者请在作品描述中正确填写游戏内UID，以确保星琼奖励的正常发放。\n' +
    '※头像挂件奖励将在绘画征集活动获奖结果公示后20个工作日内发放~\n' +
    '5、使用AI进行创作的图片禁止参赛。请参与活动的开拓者留档创作的过程稿，评选期间列车组可能会要求开拓者提供作品的过程稿，以证明创作的原创性；';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /发布符合投稿要求.*同人绘画作品/);
  assert.match(metadata.description, /编辑帖子-选择/);
  assert.doesNotMatch(metadata.description, /现已开启|2026|阶段|发放|20个|禁止参赛/);
  assert.equal(metadata.reward, undefined);
});

test('co-creation guide chooses playable feature facts instead of an earlier tutorial and chat quote', () => {
  const text = '各位奇匠好呀，奇匠小助手又来啦！\n' +
    '之前给大家分享过【奇匠小贴士】数据中心食用指南—游玩时长>>，教大家怎么看数据、找卡点。但有些奇匠跟小助手说：“数据告诉我留存不行，可我不知道具体是哪里体验不好啊！”\n' +
    '这次，小助手给大家带来一个能直接听到玩家心声的功能——「奇域共创计划」。\n' +
    '简单来说就是：奇匠把自己的奇域放上去，玩家们会来试玩，然后给奇匠一份反馈报告。\n' +
    '奇匠发起一个奇域共创邀请，可以获得玩家的游玩反馈，奇匠拿到的这些反馈，可以帮助发现自己在制作时容易忽略的问题，了解玩家真实的喜好和体验感受。\n' +
    '「奇域共创计划」传送门>>\n' +
    '当奇匠在花费较长时间制作了一个奇域，将奇域上传发布到线上之后，会不会出现以下情况？\n奇域已经发布了，但是游玩数据不太理想';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /玩家们会来试玩，然后给奇匠一份反馈报告/);
  assert.match(metadata.description, /奇匠发起一个奇域共创邀请，可以获得玩家的游玩反馈/);
  assert.doesNotMatch(metadata.description, /之前|数据中心|小助手|留存不行|[“”]|会不会|不太理想/);
});

test('sentence boundaries respect punctuation inside event titles and brackets', () => {
  const text = '亲爱的旅行者，「来奇域，快乐一夏！」网页活动限时开启，参与必得原石、重现晶簇等游戏内奖励！\n' +
    '完成网页任务，即可领取原石等奖励（请先选择「来奇域，快乐一夏！」主题）。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /「来奇域，快乐一夏！」网页活动/);
  assert.doesNotMatch(metadata.description, /。」网页|\n」网页/);
  assert.match(metadata.reward, /「来奇域，快乐一夏！」主题）/);
  assert.match(extractAnnouncementMetadata('完成"快乐一夏!"主题任务，即可领取原石奖励。').description, /完成"快乐一夏!"主题任务/);
});

test('reward facts survive an administrative distribution suffix and numbered steps are removed', () => {
  const text = '1、活动期间，旅行者完成新版本预约，将获得40原石奖励，奖励将于8月12日版本更新之后通过游戏内邮件发放。\n' +
    '2、活动期间，旅行者还可分享专属链接邀请他人预约新版本。每成功邀请1人通过专属链接完成预约，邀请人可获得20原石，最多可邀请2人。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /完成新版本预约，将获得40原石奖励。/);
  assert.match(metadata.description, /获得20原石，最多可邀请2人/);
  assert.doesNotMatch(metadata.description, /1、|2、|发放|8月12/);
  assert.match(metadata.reward, /40原石/);
  assert.doesNotMatch(metadata.reward, /发放/);
});

test('official version showcase descriptions are useful without gameplay or prizes', () => {
  const text = '亲爱的开拓者，4.4版本「鸣笛于归寂之时」专题展示页现已上线，一起看看新版本都有哪些内容吧！\n>>>点击前往<<<';
  assert.equal(extractAnnouncementMetadata(text).description, '4.4版本「鸣笛于归寂之时」专题展示页现已上线，一起看看新版本都有哪些内容吧。');
  assert.match(extractAnnouncementMetadata('1.2版本「新旅途」专题展示页上线，一起看看新版本内容吧！').description, /^1\.2版本/);
});

test('mora submission rewards and randomly selected badge recipients retain amounts and conditions', () => {
  const text = '相信在旅途过程中，一定有许多美好的瞬间值得记录。\n请把旅途走过的风景、经历的回忆拍摄下来，分享给我们。\n' +
    '活动不需要公开投稿，在活动页面完成提交即可领取5万摩拉。我们将从提交的旅行者中，随机抽取1000名赠送派蒙角色徽章（一周年庆典系列-派蒙款）。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /拍摄下来，分享给我们/);
  assert.match(metadata.description, /不需要公开投稿.*领取5万摩拉/);
  assert.match(metadata.description, /随机抽取1000名赠送派蒙角色徽章/);
  assert.match(metadata.reward, /5万摩拉/);
  assert.match(metadata.reward, /1000名.*徽章/);
});

test('quoted character rewards retain completed-binding conditions and the complete quote', () => {
  const text = '「欢迎各位绳匠，3.2版本上线后，已完成账号绑定验证的绳匠，可再次领取30菲林福利嗯呢！」\n' +
    '>>>点击添加Z宝<<<\n' +
    '三、完成绑定后，即可通过版本任务，领取30菲林奖励！\n' +
    '四、除此之外，首次添加Z宝的绳匠，还可领取60菲林奖励嗯呢！\n' +
    '绳匠们可以通过点击下方链接，或扫描下方二维码添加邦布「Z宝」。\n欢迎添加「Z宝」为好友嗯呢！';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /「欢迎各位绳匠，3.2版本上线后，已完成账号绑定验证的绳匠，可再次领取30菲林福利嗯呢！」/);
  assert.match(metadata.description, /首次添加Z宝.*领取60菲林/);
  assert.doesNotMatch(metadata.description, /三、|四、|！」。|点击添加|<<<|>>>|扫描下方二维码|欢迎添加/);
  assert.match(metadata.reward, /已完成账号绑定验证.*30菲林/);
});

test('explicit prize lists and reward summaries keep full entries within the length limit', () => {
  const text = '【一等奖】5名：\n3000星琼+周边礼包（知更鸟粘土人*1）\n【二等奖】10名：\n2000星琼+周边礼包（角色徽章*1）\n' +
    '完成所有任务即可获得' + '精美周年'.repeat(100) + '原石奖励。\n完成预约即可获得40原石。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.reward, /3000星琼\+周边礼包（知更鸟粘土人\*1）/);
  assert.match(metadata.reward, /2000星琼/);
  assert.match(metadata.reward, /40原石/);
  assert.doesNotMatch(metadata.reward, /精美周年/);
  assert.ok(metadata.reward.length <= 300);
  assert.doesNotMatch(metadata.reward, /[；，]$/);
});

test('mailbox delivery, address tutorials, payment replies and quota disclaimers stay out of rewards', () => {
  const text = '完成任务即可获得40原石奖励。\n虚拟奖励，将在兑换后发送至游戏邮箱。\n' +
    '周边奖励地址填写教程\n请获奖者回复收款信息，领取现金奖励。\n奖励名额不代表实际获奖人数。';
  const metadata = extractAnnouncementMetadata(text);
  assert.equal(metadata.reward, '完成任务即可获得40原石奖励');
  assert.doesNotMatch(metadata.description, /游戏邮箱|填写教程|收款|名额/);
});

test('a specific public-interest invitation is a useful activity description', () => {
  const text = '亲爱的旅行者：\n「拾音邮局」原神六周年特别公益行动正式开启！\n' +
    '因此，我们想邀请屏幕前的旅行者一起参与此次特别公益行动，为小朋友们的心声写下回应。\n' +
    '我们相信，人与人之间的小小善意，也能带来大大的力量。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /参与此次特别公益行动，为小朋友们的心声写下回应/);
  assert.doesNotMatch(metadata.description, /正式开启|大大的力量|亲爱的/);
});

test('annual data review facts are chosen before a poetic quote and bracketed numbering is removed', () => {
  const text = '「用一帧帧影像，为你记录回忆的绚烂多彩。」\n' +
    '「忆旅的流彩叙映」网页活动开启，舰长参与数据回顾可获得水晶×160等奖励~\n' +
    '1）活动期间，舰长可以在活动内回顾自己的年度数据。完成回顾后，可获得水晶×100奖励。\n' +
    '5）舰长可以拆开自己分享的礼盒，每位舰长只能领取一次同一位舰长分享的礼盒~';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /回顾自己的年度数据/);
  assert.match(metadata.description, /水晶×160/);
  assert.doesNotMatch(metadata.description, /一帧帧影像|绚烂多彩|1）|5）/);
});

test('creative competition descriptions keep participation context and exclude bare prize tiers and schedules', () => {
  const text = '亲爱的旅行者，\n「千星之约·奇域创作大赛」活动现已开启！\n' +
    '本次创作赛活动不设玩法品类与题材限制。在千星沙箱中开启创作之旅并按照参赛规则发布奇域，即有机会竞逐「一号创作票券」、原石等的丰富奖励，优质奇域作品还将获得更多官方宣传资源。\n' +
    '〓活动时间〓\n制作投稿：7.1版更后  ~ 11月2日 11:59\n奇域评审：2026年11月2日 12:00 ~ 12月4日 23:59\n' +
    '〓参与方式〓\n在制作投稿期内按照投稿要求在千星沙箱上传界面的“赛事报名”中，选择参加“千星之约·奇域创作大赛”后发布参赛奇域，即视为参与活动；\n' +
    '〓活动奖励〓\n璀璨奇匠奖（2名）\n一号创作票券*30000 + 原石*6480\n闪耀奇匠奖（5名）\n一号创作票券*15000 + 原石*3280';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /不设玩法品类与题材限制/);
  assert.match(metadata.description, /按照参赛规则发布奇域，即有机会竞逐/);
  assert.doesNotMatch(metadata.description, /制作投稿：|7\.1|30000|6480|15000|3280/);
  assert.match(metadata.reward, /一号创作票券\*30000 \+ 原石\*6480/);
});

test('version preview descriptions retain the opening facts without cutting time ranges or test-server disclaimers', () => {
  const text = '9.1版本「时序照新」即将开启，全新S级角色「时序之律者」登场，参与「时序之律者」角色补给时首次十连免费。点击下方链接查看新版本情报吧~\n' +
    '十周年庆典登录活动现已开放，参与可领取装备补给卡、棱镜圣痕直升券、十周年纪念勋章奖励，9.1版本期间还将开放更多登录活动，累计登录可领取「名以时序」圣痕自选箱、S级角色卡、庆典角色十连补给券、水晶等奖励。\n' +
    '*爱酱小贴士：\n1）9月19日活动上线后~9月28日04:00期间，首次参与网页内分享活动可获得20水晶~\n2）页面中所有内容均来自测试服，请以正式服效果为准~';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /^9\.1版本「时序照新」即将开启/);
  assert.match(metadata.description, /全新S级角色「时序之律者」登场/);
  assert.doesNotMatch(metadata.description, /9月28日|测试服|正式服|点击下方/);
  assert.doesNotMatch(metadata.reward, /9月28日|测试服/);
});

test('coin draw descriptions restore reading order and keep delivery and account notices out of prizes', () => {
  const text = '本期活动时间：2026/9/25 12:00-2026/9/27 23:59\n参与方式：\n' +
    '活动期间，使用米游币参与抽抽乐活动，即有机会获得游戏虚拟道具、实物周边等奖励。\n' +
    '每次抽奖可根据需求选择单抽或十连抽，一起来试试手气吧！\n本期活动期间，每次抽取需耗费200米游币，单人最多可参与50次。\n' +
    '活动奖励一览：\n原石*60\n摩拉*50000\n活动说明：\n' +
    '2、实物奖励，将在兑换截止结束后最多60个工作日内发货，请关注各自奖励说明；自选款式存在库存限制，建议尽快填写收货地址，兑换奖品；\n' +
    '4、虚拟奖励，将在兑换后发送至游戏角色所在的邮箱内；\n5、米游币及头像挂件奖励，将自动发送到米游社账户；\n' +
    '请获得现金奖励的旅行者关注私信，并回复收款信息。';
  const metadata = extractAnnouncementMetadata(text);
  assert.match(metadata.description, /^活动期间，使用米游币参与抽抽乐活动，即有机会获得/);
  assert.match(metadata.description, /单抽或十连抽/);
  assert.doesNotMatch(metadata.description, /发货|实物奖励|邮箱|账户|收款|现金|奖励一览|原石\*60/);
  assert.match(metadata.reward, /原石\*60/);
  assert.doesNotMatch(metadata.reward, /发货|实物奖励|邮箱|账户|收款|现金|奖励一览|单抽/);
});
