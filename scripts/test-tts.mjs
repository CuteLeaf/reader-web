/**
 * 朗读断句与选词规则的单元测试。
 * 运行：pnpm test:tts
 */
import { splitSentences, MAX_CHUNK } from '../src/lib/tts/segment.ts';
import { pickTerm } from '../src/lib/selection/selection.ts';

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(
      `  FAIL  ${name}\n        实际 ${JSON.stringify(actual)}\n        期望 ${JSON.stringify(expected)}`,
    );
  }
}

function ok(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? `  ${detail}` : ''}`);
  }
}

console.log('断句：');
eq('按句号切分', splitSentences('他去书店了。她回家做饭。'), ['他去书店了。', '她回家做饭。']);
eq('问号与感叹号', splitSentences('真的吗？太好了！'), ['真的吗？', '太好了！']);
eq('无标点整句', splitSentences('这一段没有句末标点'), ['这一段没有句末标点']);
eq('空串', splitSentences('   '), []);
eq('段落换行压成空格', splitSentences('第一段\n第二段。'), ['第一段 第二段。']);
eq('连续标点不切碎', splitSentences('怎么会这样？！我也不知道。'), [
  '怎么会这样？！',
  '我也不知道。',
]);
eq('引号并入前一句', splitSentences('他说：“走吧。”然后就走了。'), [
  '他说：“走吧。”',
  '然后就走了。',
]);
eq('省略号算句末', splitSentences('他犹豫了很久……最后点头。'), ['他犹豫了很久……', '最后点头。']);

const long = `${'他慢慢走进那间旧书店，'.repeat(20)}然后离开。`;
const longChunks = splitSentences(long);
ok('超长句被拆成多段', longChunks.length > 1, `段数 ${longChunks.length}`);
ok(
  `每段不超过 ${MAX_CHUNK} 字`,
  longChunks.every((c) => c.length <= MAX_CHUNK),
  `最长 ${Math.max(...longChunks.map((c) => c.length))}`,
);
ok('拆句后内容不丢字', longChunks.join('').replace(/\s/g, '') === long.replace(/\s/g, ''));

console.log('\n选词：');
eq('短选区整体作为词条', pickTerm('雨夜书店'), '雨夜书店');
eq('去掉首尾标点', pickTerm('“雨夜书店”。'), '雨夜书店');
eq('长选区取开头中文词', pickTerm('他走进那间旧书店然后离开，外面下着雨'), '他走进那');
eq('英文取单词', pickTerm('the quick brown fox jumps over'), 'the');
eq('纯标点返回空', pickTerm('——……'), '');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
