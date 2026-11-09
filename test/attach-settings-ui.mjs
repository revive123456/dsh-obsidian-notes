/**
 * 附件设置面板的布局契约（离线）。
 *
 * 事故现场：四个「附件位置」模式（Vault 根 / 固定目录 / 与笔记同目录 /
 * 笔记目录下子目录）被放进 24×24 的图标按钮里，中文标签在窄侧边栏里被挤成
 * 一列一个字、竖着盖住下面的输入框和开关。修法是换成下拉框 + 表单行，这里
 * 钉住几条不能再回退的形状：
 *   - 四个模式标签作为 <option> 整行显示，不再进 dsh-obs-mini；
 *   - 面板是纵向表单（flex-direction:column），不是会互相挤压的横排；
 *   - 输入行/开关行在窄宽度下能正常折行，复选框保持系统默认尺寸（不硬改大小）。
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  src: readFileSync(join(root, "src", "client.js"), "utf8"),
  lib: readFileSync(join(root, "lib", "client.js"), "utf8"),
};

const failures = [];
function check(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failures.push(name);
}

// 模式选择：<select> + 四个 <option>，标签走 i18n，不再用按钮夹住长中文
const modeSelect = /createElement\("select", \{\s*className: "dsh-obs-select",\s*value: attachCfg\.mode,/;
const modeOptions = /\["root", "fixed", "note", "sub"\]\.map\(\(m\) => createElement\("option", \{ key: m, value: m \}, t\(`attachMode_\$\{m\}`\)\)\)/;
const oldButtons = /\["root", "fixed", "note", "sub"\]\.map\(\(m\) => createElement\("button"/;

for (const [label, text] of Object.entries(files)) {
  check(`${label}: 附件位置用下拉框选择`, modeSelect.test(text));
  check(`${label}: 四个位置模式是 option 且带完整标签`, modeOptions.test(text));
  check(`${label}: 位置模式不再塞进 24×24 图标按钮`, !oldButtons.test(text));
}

// CSS 形状
const attachCfgRule = /\.dsh-obs-attachcfg\{([^}]*)\}/.exec(files.src)?.[1] ?? "";
check("面板是纵向表单", attachCfgRule.includes("display:flex;flex-direction:column"), attachCfgRule);
check("面板不再横向挤压换行", !attachCfgRule.includes("flex-wrap:wrap"), attachCfgRule);
check("下拉框样式存在", /\.dsh-obs-select\{/.test(files.src));
check("输入行样式存在", /\.dsh-obs-inputrow\{/.test(files.src));
const selectRule = /\.dsh-obs-select\{([^}]*)\}/.exec(files.src)?.[1] ?? "";
check("下拉框整行宽、不收缩", selectRule.includes("width:100%"), selectRule);
const cfglineRule = /\.dsh-obs-cfgline\{([^}]*)\}/.exec(files.src)?.[1] ?? "";
check("开关标签按行首对齐折行", cfglineRule.includes("align-items:flex-start"), cfglineRule);
const checkboxRule = /\.dsh-obs-cfgline input\[type=checkbox\]\{([^}]*)\}/.exec(files.src)?.[1] ?? "";
check("复选框保留系统默认外观", checkboxRule !== "" && !/width:/.test(checkboxRule) && !/height:/.test(checkboxRule), checkboxRule);

// 输入框打开面板时带出当前值（旧版点齿轮打开时是空的）
check("打开面板时回填当前目录/子目录", /setAttachInput\(typeof attachDir === "string"/.test(files.src));

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) FAILED: ${failures.join(" | ")}`);
  process.exit(1);
}
console.log("\nall attachment-settings UI checks passed ✔");
