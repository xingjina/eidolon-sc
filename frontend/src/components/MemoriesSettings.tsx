"use client";

import { useEffect, useRef, useState } from "react";

import { FailureNotice } from "@/components/app/FailureNotice";
import { MarkedAvatar } from "@/components/app/MarkedAvatar";
import { PROSE_WIDTH } from "@/components/app/SettingsSection";
import { useDirectory } from "@/components/conversations/ConversationDirectory";
import { SettingsPane } from "@/components/settings/SettingsPane";
import { useSettingsValues } from "@/components/settings/SettingsValues";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { copy } from "@/i18n";
import {
  ApiError,
  clearMemories,
  deleteMemory,
  listMemories,
  restoreMemory,
  updateMemory,
  type Memory,
} from "@/lib/api";
import { toFailure, type Failure } from "@/lib/failure";
import { sourceCharacter, supersededMark } from "@/lib/memories";
import { cn } from "@/lib/utils";
import { EditRecordIcon, TrashIcon } from "@/theme/icons";

const t = copy.memories;

/**
 * 设置「记忆」：所有角色共用的、关于用户的记忆。可以改文字（改完她会重新记住新的说法），
 * 被取代的可以「恢复」让它重新生效；删除与清空照旧，都要先确认，执行键是挂断红。
 * 每条都标出来源角色；被取代的原地列出，淡一些并标出来。记忆是一行一行的列表（细分隔线，不套卡片）。
 * 「清空」在二级页首的末端。条数一变就告诉设置的 layout，一级「记忆」的摘要跟着变。
 */
export function MemoriesSettings() {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deleting, setDeleting] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState<Set<number>>(new Set());
  // 要删的那条。确认框关上时只把 confirmingDelete 置成 false，pendingDelete 留着，关闭动画里的文字不会闪成空白。
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  // 正在编辑的那条：编辑框开着时是它，draft 是框里的字。
  const [editing, setEditing] = useState<Memory | null>(null);
  const [draft, setDraft] = useState("");
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editFailure, setEditFailure] = useState<Failure | null>(null);
  // 只用最后一次重新取到的列表：连着删几条时，先发出的那次晚到，会把后删的又列出来。
  const refetches = useRef(0);
  const { memoryCountChanged } = useSettingsValues();
  // 只用来给来源角色配头像；还没载入时照样列出记忆。
  const characters = useDirectory().characters ?? [];

  useEffect(() => {
    listMemories().then(setMemories, (e) => setFailure(toFailure(e)));
  }, []);

  const count = memories?.length;
  useEffect(() => {
    if (count !== undefined) memoryCountChanged(count);
  }, [count, memoryCountChanged]);

  const forget = (id: number) => setMemories((list) => list?.filter((m) => m.id !== id) ?? null);

  function askToRemove(memory: Memory) {
    setPendingDelete(memory);
    setConfirmingDelete(true);
  }

  async function remove(memory: Memory) {
    const id = memory.id;
    setConfirmingDelete(false);
    setDeleting((ids) => new Set(ids).add(id));
    setFailure(null);
    try {
      await deleteMemory(id);
      forget(id);
      // 删掉的是取代别的记忆的那条时，被它取代的会恢复，重新取一次才看得到；取不到时照旧列着。
      const refetch = ++refetches.current;
      listMemories().then((list) => refetch === refetches.current && setMemories(list), () => {});
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) forget(id); // 已经删掉了
      else setFailure(toFailure(e));
    } finally {
      setDeleting((ids) => {
        const rest = new Set(ids);
        rest.delete(id);
        return rest;
      });
    }
  }

  async function clear() {
    setClearing(true);
    setFailure(null);
    try {
      await clearMemories();
      setMemories([]);
      setConfirmingClear(false);
    } catch (e) {
      setFailure(toFailure(e));
      setConfirmingClear(false);
    } finally {
      setClearing(false);
    }
  }

  function startEditing(memory: Memory) {
    setEditing(memory);
    setDraft(memory.text);
    setDraftPrivate(memory.private);
    setEditFailure(null);
  }

  function closeEditing() {
    if (saving) return;
    setEditing(null);
    setDraft("");
    setDraftPrivate(false);
    setEditFailure(null);
  }

  async function save() {
    if (!editing) return;
    const text = draft.trim();
    if (!text) return;
    const privateNow = draftPrivate;
    if (text === editing.text && privateNow === editing.private) {
      closeEditing();
      return;
    }
    const id = editing.id;
    setSaving(true);
    setEditFailure(null);
    try {
      await updateMemory(id, text, privateNow);
      setMemories(
        (list) => list?.map((m) => (m.id === id ? { ...m, text, private: privateNow } : m)) ?? null,
      );
      setEditing(null);
      setDraft("");
      setDraftPrivate(false);
    } catch (e) {
      setEditFailure(toFailure(e));
    } finally {
      setSaving(false);
    }
  }

  async function restore(memory: Memory) {
    const id = memory.id;
    setRestoring((ids) => new Set(ids).add(id));
    setFailure(null);
    try {
      await restoreMemory(id);
      setMemories((list) => list?.map((m) => (m.id === id ? { ...m, superseded: false } : m)) ?? null);
    } catch (e) {
      setFailure(toFailure(e));
    } finally {
      setRestoring((ids) => {
        const rest = new Set(ids);
        rest.delete(id);
        return rest;
      });
    }
  }

  const hasMemories = !!memories && memories.length > 0;

  return (
    <SettingsPane
      category="memories"
      end={
        hasMemories && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmingClear(true)} disabled={clearing}>
            {t.clear}
          </Button>
        )
      }
    >
      <div className="flex flex-1 flex-col gap-4">
        <p className={cn(PROSE_WIDTH, "text-body text-muted-foreground")}>{t.intro}</p>

        {failure && <FailureNotice failure={failure} />}

        {memories === null ? (
          !failure && <p className="text-body text-muted-foreground">{t.loading}</p>
        ) : memories.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{t.empty}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y">
            {memories.map((memory) => {
              const source = sourceCharacter(memory, characters);
              const name = memory.source_character_name ?? t.goneCharacter;
              const created = new Date(memory.created_at);
              const mark = supersededMark(memory);
              const busy = deleting.has(memory.id);
              const restoringThis = restoring.has(memory.id);
              return (
                <li key={memory.id} className="flex items-start gap-3 py-4">
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
                            disabled={busy || clearing}
                            onClick={() => startEditing(memory)}
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
                              disabled={busy || restoringThis || clearing}
                              onClick={() => restore(memory)}
                            />
                          }
                        >
                          {restoringThis ? <Spinner /> : t.restore}
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
                            disabled={busy || clearing}
                            onClick={() => askToRemove(memory)}
                          />
                        }
                      >
                        {busy ? <Spinner /> : <TrashIcon />}
                      </TooltipTrigger>
                      <TooltipContent>{t.remove}</TooltipContent>
                    </Tooltip>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && closeEditing()}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.editTitle}</DialogTitle>
            <DialogDescription>{t.editHint}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={200}
            rows={4}
            aria-label={t.editTitle}
          />
          <label className="flex items-center gap-2 text-body">
            <Checkbox
              checked={draftPrivate}
              onCheckedChange={(checked) => setDraftPrivate(checked === true)}
            />
            <span>{t.privateLabel(editing?.source_character_name ?? t.goneCharacter)}</span>
          </label>
          {editFailure && <FailureNotice failure={editFailure} />}
          <DialogFooter>
            <Button variant="ghost" onClick={closeEditing} disabled={saving}>
              {copy.common.cancel}
            </Button>
            <Button onClick={save} disabled={saving || !draft.trim()}>
              {saving && <Spinner data-icon="inline-start" />}
              {t.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.removeTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? t.removeDescription(pendingDelete.text) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => pendingDelete && remove(pendingDelete)}>
              {t.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmingClear} onOpenChange={(open) => !clearing && setConfirmingClear(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.clearTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.clearDescription(memories?.length ?? 0)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={clearing}>{copy.common.cancel}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={clearing} onClick={clear}>
              {clearing && <Spinner data-icon="inline-start" />}
              {t.clearConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPane>
  );
}
