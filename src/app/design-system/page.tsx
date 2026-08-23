"use client";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  SettingsCard,
  FieldRow,
  StatusBanner,
  EmptyState,
  SectionPage,
  IconAction,
} from "@/components/patterns";
import {
  CheckCircle,
  Warning,
  Info,
  Gear,
  Trash,
  Plus,
  MagnifyingGlass,
  Copy,
} from "@/components/ui/icon";
import { BuckyballIcon, type BuckyballIconName } from "@/components/ui/semantic-icon";

const ICON_SEMANTICS: { name: BuckyballIconName; use: string }[] = [
  { name: "model", use: "æ¨¡åï¼Cubeï¼é Brainï¼? },
  { name: "runtime", use: "æ§è¡å¼æï¼Chipï¼é Lightningï¼? },
  { name: "provider", use: "æå¡å? },
  { name: "memory", use: "è®°å¿ï¼Brainï¼? },
  { name: "skill", use: "å¯è°ç¨è½åï¼é­æ³æ£ï¼" },
  { name: "plugin", use: "å®è£å?/ å®¹å¨ï¼æ¼å¾ï¼" },
  { name: "mcp", use: "MCP server / åè®®" },
  { name: "cli", use: "å½ä»¤å·¥å·ç®å½ï¼â  terminalï¼? },
  { name: "terminal", use: "shell ä¼è¯ï¼â  cliï¼? },
  { name: "assistant", use: "å©ç / å·¥ä½å? },
  { name: "task", use: "å®æ¶ä»»å¡" },
  { name: "widget", use: "Widget ç»ä»¶" },
  { name: "artifact", use: "Artifact è¡¨ç°å±? },
  { name: "preview", use: "é¢è§å¨ä½" },
  { name: "code", use: "ä»£ç  / snippet" },
  { name: "file", use: "æä»¶èµæº" },
  { name: "success", use: "æåç¶æ? },
  { name: "warning", use: "è­¦åç¶æ? },
  { name: "error", use: "éè¯¯ç¶æ? },
  { name: "loading", use: "å è½½ä¸? },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4" data-section={title}>
      <h2 className="text-lg font-semibold border-b border-border pb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function DesignSystemPage() {
  return (
    <SectionPage maxWidth="lg" className="space-y-12">
      {/* ââ Buttons ââ */}
      <Section title="Buttons">
        <div className="flex flex-wrap gap-3">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </Section>

      {/* ââ Icon Actions ââ */}
      <Section title="Icon Actions">
        <div className="flex gap-3">
          <IconAction icon={<Gear size={16} />} tooltip="Settings" />
          <IconAction icon={<Trash size={16} />} tooltip="Delete" />
          <IconAction icon={<Copy size={16} />} tooltip="Copy" />
          <IconAction icon={<Plus size={16} />} tooltip="Add" size="sm" />
          <IconAction icon={<MagnifyingGlass size={16} />} tooltip="Search" size="sm" />
        </div>
      </Section>

      {/* ââ Icon Semantics (CodePilot layer) ââ */}
      <Section title="Icon Semantics">
        <p className="text-sm text-muted-foreground">
          ä¸å¡ä»£ç ç?<code className="text-xs bg-muted px-1 py-0.5 rounded">{`<BuckyballIcon name="..." />`}</code> è¡¨è¾¾äº§åæ¦å¿µï¼ä¸ç´å¼ vendor icon åãä¸ä¸ªæ¦å¿µä¸ä¸?glyphï¼å²çªå¨ <code className="text-xs bg-muted px-1 py-0.5 rounded">SEMANTIC_MAP</code> åç¹è£å³ãå®æ´å­å¸è§ <code className="text-xs bg-muted px-1 py-0.5 rounded">docs/handover/icon-system.md</code>ã?        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {ICON_SEMANTICS.map(({ name, use }) => (
            <div key={name} className="flex items-center gap-3 rounded-lg border border-border p-3">
              <BuckyballIcon name={name} size="lg" aria-hidden />
              <div className="min-w-0">
                <div className="text-sm font-medium">{name}</div>
                <div className="text-xs text-muted-foreground truncate">{use}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ââ Inputs ââ */}
      <Section title="Inputs">
        <div className="space-y-3 max-w-md">
          <Input placeholder="Default input" />
          <Input type="password" placeholder="Password input" />
          <Select defaultValue="option1">
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="option1">Option 1</SelectItem>
              <SelectItem value="option2">Option 2</SelectItem>
              <SelectItem value="option3">Option 3</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Section>

      {/* ââ Badges ââ */}
      <Section title="Badges">
        <div className="flex flex-wrap gap-2">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
        </div>
      </Section>

      {/* ââ Settings Card ââ */}
      <Section title="Settings Card">
        <SettingsCard title="Card with title" description="This is a description for the card.">
          <p className="text-sm text-muted-foreground">Card content goes here.</p>
        </SettingsCard>

        <SettingsCard>
          <p className="text-sm">Card without title â?just content.</p>
        </SettingsCard>

        <SettingsCard className="border-primary/50 bg-primary/5" title="Active state card">
          <p className="text-sm text-muted-foreground">With custom border color for active state.</p>
        </SettingsCard>
      </Section>

      {/* ââ Field Row ââ */}
      <Section title="Field Row">
        <SettingsCard>
          <FieldRow label="Toggle setting" description="Enable or disable this feature">
            <Switch />
          </FieldRow>
          <FieldRow label="Select option" description="Choose your preference" separator>
            <Select defaultValue="auto">
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Text input" separator>
            <Input placeholder="Enter value" className="w-[200px]" />
          </FieldRow>
        </SettingsCard>
      </Section>

      {/* ââ Status Banner ââ */}
      <Section title="Status Banner">
        <div className="space-y-3">
          <StatusBanner variant="success" icon={<CheckCircle size={16} />}>
            Operation completed successfully.
          </StatusBanner>
          <StatusBanner variant="warning" icon={<Warning size={16} />}>
            This action cannot be undone.
          </StatusBanner>
          <StatusBanner variant="error" icon={<Warning size={16} />}>
            Failed to save settings. Please try again.
          </StatusBanner>
          <StatusBanner variant="info" icon={<Info size={16} />}>
            New features are available in this version.
          </StatusBanner>
        </div>
      </Section>

      {/* ââ Empty State ââ */}
      <Section title="Empty State">
        <EmptyState
          icon={<MagnifyingGlass size={32} />}
          title="No results found"
          description="Try adjusting your search terms or filters."
          action={<Button size="sm">Clear filters</Button>}
        />
      </Section>

      {/* ââ Section Page ââ */}
      <Section title="Section Page (layout)">
        <p className="text-sm text-muted-foreground">
          This entire page uses <code className="text-xs bg-muted px-1 py-0.5 rounded">SectionPage maxWidth=&quot;lg&quot;</code> for consistent max-width and spacing.
        </p>
      </Section>
    </SectionPage>
  );
}
