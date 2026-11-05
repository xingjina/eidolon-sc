import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy } from "@/i18n";
import type { Character, Memory } from "@/lib/api";
import { supersededMark } from "@/lib/memories";
import { cn } from "@/lib/utils";
import { EditRecordIcon, TrashIcon } from "@/theme/icons";
import { herVars } from "@/theme/herVars";

const t = copy.memories;

/**
 * 记忆列表的一行：来源角色头像、文本、徽章、日期和编辑 / 恢复 / 删除。
 * 私有行是一个 `rounded-xl` 的圆角块：铺 `--her-wall`、行首 2px `--her-mark`；公共行不上色、仍是平面行。
 * 圆角底色包在内层，外层 `<li>` 只管列表和分隔线，分隔线不会横穿圆角。
 * 公共记忆页和角色记忆页共用。
 */
export function MemoryRow({
  memory,
  source,
  tinted,
  gutter,
  busy,
  restoring,
  disabled,
  onEdit,
  onRemove,
  onRestore,
}: {
  memory: Memory;
  source: Character | null;
  /** 私有行：铺她的颜色。公共行和来源不明的行不上色。 */
  tinted: boolean;
  /** 角色记忆里每行都留出 2px 的行首记号位（公行为透明，私行为她的颜色）；公共记忆页不留，和原来的列表一样。 */
  gutter: boolean;
  busy: boolean;
  restoring: boolean;
  disabled: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  const name = memory.source_character_name ?? t.goneCharacter;
  const created = new Date(memory.created_at);
  const mark = supersededMark(memory);
  const isTinted = tinted && source !== null;
  return (
    <li className={cn(isTinted && "py-1")}>
      <div
        style={isTinted && source ? herVars(source.color) : undefined}
        className={cn(
          "flex items-start gap-3",
          isTinted
            ? "rounded-xl border-l-2 border-her-mark bg-her-wall px-3 py-3"
            : "py-4",
          !isTinted && gutter && "border-l-2 border-transparent pl-3 pr-3",
        )}
      >
        <div className="pt-0.5">
          <MarkedAvatar name={name} src={source?.avatar_url} size="sm" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn("text-body break-words", mark && "text-muted-foreground")}>{memory.text}</p>
          <div className="flex flex-wrap items-center gap-2">
            {mark && <Badge variant="secondary">{mark}</Badge>}
            {memory.private && <Badge variant="outline">{t.privateBadge(name)}</Badge>}
            <span className="text-subtitle text-muted-foreground">
              {t.toldTo(name)} · {t.date(created.getFullYear(), created.getMonth() + 1, created.getDate())}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.editLabel(memory.text)}
                  disabled={busy || disabled}
                  onClick={onEdit}
                />
              }
            >
              <EditRecordIcon />
            </TooltipTrigger>
            <TooltipContent>{t.edit}</TooltipContent>
          </Tooltip>
          {memory.superseded && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || restoring || disabled}
                    onClick={onRestore}
                  />
                }
              >
                {restoring ? <Spinner /> : t.restore}
              </TooltipTrigger>
              <TooltipContent>{t.restoreLabel(memory.text)}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.removeLabel(memory.text)}
                  disabled={busy || disabled}
                  onClick={onRemove}
                />
              }
            >
              {busy ? <Spinner /> : <TrashIcon />}
            </TooltipTrigger>
            <TooltipContent>{t.remove}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </li>
  );
}
