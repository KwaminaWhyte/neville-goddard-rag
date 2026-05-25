// Lightweight markdown renderer for React Native — no external dependency
// (avoids React 19 / RN 0.85 peer-dep risk). Supports the subset the coach
// emits: headings (#..###), bold, italic, inline code, links, bullet/numbered
// lists, blockquotes, horizontal rules, and a "**Sources:**" footer.
import { Fragment, ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { colors, font, space } from "../lib/theme";

type Props = { children: string; compact?: boolean };

export default function Markdown({ children, compact }: Props) {
  const blocks = parseBlocks(children || "");
  return (
    <View>
      {blocks.map((b, i) => (
        <Block key={i} block={b} compact={compact} />
      ))}
    </View>
  );
}

type BlockNode =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "quote"; text: string }
  | { type: "hr" }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] };

function parseBlocks(src: string): BlockNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: BlockNode[] = [];
  let para: string[] = [];
  let ul: string[] = [];
  let ol: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push({ type: "p", text: para.join(" ").trim() });
      para = [];
    }
  };
  const flushLists = () => {
    if (ul.length) {
      out.push({ type: "ul", items: ul });
      ul = [];
    }
    if (ol.length) {
      out.push({ type: "ol", items: ol });
      ol = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushLists();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushAll();
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      out.push({ type: "hr" });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      out.push({ type: "h", level: h[1].length, text: h[2] });
      continue;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara();
      flushLists();
      out.push({ type: "quote", text: q[1] });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line.trim());
    if (bullet) {
      flushPara();
      if (ol.length) flushLists();
      ul.push(bullet[1]);
      continue;
    }
    const num = /^\d+[.)]\s+(.*)$/.exec(line.trim());
    if (num) {
      flushPara();
      if (ul.length) flushLists();
      ol.push(num[1]);
      continue;
    }
    flushLists();
    para.push(line.trim());
  }
  flushAll();
  return out;
}

function Block({ block, compact }: { block: BlockNode; compact?: boolean }) {
  const gap = compact ? space.sm : space.md;
  switch (block.type) {
    case "h": {
      const size =
        block.level === 1 ? font.sizes.xl : block.level === 2 ? font.sizes.lg : font.sizes.md;
      return (
        <Text style={[styles.h, { fontSize: size, marginTop: gap, marginBottom: space.xs }]}>
          <Inline text={block.text} />
        </Text>
      );
    }
    case "p":
      return (
        <Text style={[styles.p, { marginBottom: gap }]}>
          <Inline text={block.text} />
        </Text>
      );
    case "quote":
      return (
        <View style={[styles.quote, { marginBottom: gap }]}>
          <Text style={styles.quoteText}>
            <Inline text={block.text} />
          </Text>
        </View>
      );
    case "hr":
      return <View style={styles.hr} />;
    case "ul":
      return (
        <View style={{ marginBottom: gap }}>
          {block.items.map((it, i) => (
            <View key={i} style={styles.li}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.liText}>
                <Inline text={it} />
              </Text>
            </View>
          ))}
        </View>
      );
    case "ol":
      return (
        <View style={{ marginBottom: gap }}>
          {block.items.map((it, i) => (
            <View key={i} style={styles.li}>
              <Text style={[styles.bullet, { color: colors.gold }]}>{i + 1}.</Text>
              <Text style={styles.liText}>
                <Inline text={it} />
              </Text>
            </View>
          ))}
        </View>
      );
  }
}

// Inline parser: **bold**, *italic* / _italic_, `code`, [text](url).
function Inline({ text }: { text: string }): ReactNode {
  const tokens: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);
    if (m[2] != null) tokens.push(<Text key={key++} style={styles.bold}>{m[2]}</Text>);
    else if (m[4] != null) tokens.push(<Text key={key++} style={styles.italic}>{m[4]}</Text>);
    else if (m[6] != null) tokens.push(<Text key={key++} style={styles.italic}>{m[6]}</Text>);
    else if (m[8] != null) tokens.push(<Text key={key++} style={styles.code}>{m[8]}</Text>);
    else if (m[10] != null) {
      const label = m[10];
      const url = m[11];
      tokens.push(
        <Text key={key++} style={styles.link} onPress={() => Linking.openURL(url).catch(() => {})}>
          {label}
        </Text>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{tokens}</>;
}

const styles = StyleSheet.create({
  h: { color: colors.gold, fontFamily: font.serif },
  p: { color: colors.ink, fontSize: font.sizes.sm, lineHeight: 22, fontFamily: font.family.body },
  bold: { fontFamily: font.family.bodySemibold, color: colors.ink },
  italic: { fontStyle: "italic" },
  code: {
    fontFamily: "monospace",
    color: colors.gold,
    backgroundColor: colors.base,
    fontSize: font.sizes.xs,
  },
  link: { color: colors.gold, textDecorationLine: "underline" },
  quote: { borderLeftWidth: 2, borderLeftColor: colors.gold, paddingLeft: space.md },
  quoteText: { color: colors.muted, fontStyle: "italic", fontSize: font.sizes.sm, lineHeight: 22, fontFamily: font.family.body },
  hr: { height: 1, backgroundColor: colors.line, marginVertical: space.md },
  li: { flexDirection: "row", marginBottom: space.xs, paddingRight: space.md },
  bullet: { color: colors.accent, width: 22, fontSize: font.sizes.sm, fontFamily: font.family.body },
  liText: { color: colors.ink, fontSize: font.sizes.sm, lineHeight: 22, flex: 1, fontFamily: font.family.body },
});
