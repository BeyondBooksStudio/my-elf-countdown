import { useEffect, useMemo, useRef, useState, type FormEvent, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Download,
  Gift,
  Heart,
  Lightbulb,
  Loader2,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import { toast } from "sonner";
import AuthForm from "@/components/AuthForm";
import { useAuth } from "@/_core/hooks/useAuth";
import RewardTemplateLibrary, { type RewardTemplateItem } from "@/components/RewardTemplateLibrary";
import { compressImage } from "@/lib/image";
import { collectFamilyBackup, downloadFamilyBackupFile } from "@/lib/familyBackupDownload";
import ParentPinGate from "./ParentPinGate";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../server/routers";

type Outputs = inferRouterOutputs<AppRouter>;
type Overview = Outputs["planner"]["overview"];
type PlannerDay = Overview["days"][number];
type PlannerReward = Overview["rewards"][number];
type PlannerRewardTemplate = Outputs["planner"]["listRewardTemplates"][number];
type ChildView = Outputs["planner"]["childView"];
type CountdownLength = 12 | 24;
type Tab = "countdown" | "rewards" | "stories" | "ideas" | "privacy";

type Story = { title: string; theme: string; readTime: string; text: string };
const HERO_IMAGE = "/manus-storage/async-images/bGgU0Hw06xExME7JPzDIFy/image-1.webp";
const CHILD_IMAGE = "/manus-storage/async-images/bGgU0Hw06xExME7JPzDIFy/image-2.webp";
const FALLBACK_HERO_IMAGE = "/manus-storage/async-images/27V2WxKsMY57Gr0gMsRiMb/image-1.webp";
const SANTA_AUDIO_URL = "/audio/santa-final-day.mp3";

const stories: Story[] = [
  {
    title: "The Star That Waited",
    theme: "Kindness",
    readTime: "2 min read",
    text: "At the edge of the winter wood, a little star had slipped from the sky and landed in a mitten. The elf found it on the path. ‘I know where you belong,’ she whispered, but the star glowed brightest whenever someone helped another. So they stopped to carry a basket, shared a scarf with a chilly robin, and walked slowly beside a friend who needed a rest. By the time they reached the hill, the star was shining like a tiny sunrise. It floated home on a snowflake. The elf smiled: the kind things had made the path bright, too.",
  },
  {
    title: "A Very Small Helping Hand",
    theme: "Helping",
    readTime: "2 min read",
    text: "The workshop was busy, and a ribbon had rolled beneath the table. ‘I’m too small to help,’ sighed Pip the winter helper. Just then, a little mouse pointed to the ribbon. Pip could reach it! Then Pip held a spool, passed a tag, and picked up one fallen paper star. Soon the whole table was ready. ‘You didn’t do everything,’ said the old maker. ‘You did the next small thing.’ Pip tucked that thought into a pocket, right beside the brass bell.",
  },
  {
    title: "The Cosy Cloud Plan",
    theme: "Rest and connection",
    readTime: "3 min read",
    text: "On a blustery day, the elf had planned a grand snow adventure. But the wind rattled the windows, and everyone felt a little worn out. So they changed the plan. A blanket became a cloud, two cushions became a hill, and a favourite book became the map. They took turns choosing a page and made up soft voices for the animals. Nothing went the way the elf first imagined, yet the room felt warm and full. ‘A good plan can change,’ she said. ‘The important part is being together.’ Outside, the clouds hurried by. Inside, nobody needed to hurry at all.",
  },
];

const ideas = [
  { title: "Three-book rescue", time: "2 minutes", tag: "Helping", detail: "Put three books back together, then choose one to read." },
  { title: "Thank-you doodle", time: "5 minutes", tag: "Kindness", detail: "Draw a tiny thank-you picture for someone at home." },
  { title: "Blanket hideaway", time: "5 minutes", tag: "Imagination", detail: "Turn a blanket or box into a cosy elf-sized nook." },
  { title: "Napkin helper", time: "2 minutes", tag: "Helping", detail: "Set out napkins or cups together for a snack." },
  { title: "Window snowflake hunt", time: "3 minutes", tag: "Calm", detail: "Spot three interesting shapes outside or through a window." },
  { title: "Kind words note", time: "5 minutes", tag: "Kindness", detail: "Leave a simple kind note for someone in your family." },
  { title: "Favourite-song pause", time: "3 minutes", tag: "Calm", detail: "Listen to a favourite song and name one cosy thing." },
  { title: "Silly winter hello", time: "2 minutes", tag: "Imagination", detail: "Make up a cheerful winter greeting and share it." },
];

function makeDayDate(startDate: string, dayNumber: number) {
  const [year, month, day] = startDate.split("-").map(Number);
  return new Date(year, month - 1, day + dayNumber - 1);
}

function shortDate(startDate: string, dayNumber: number) {
  return makeDayDate(startDate, dayNumber).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function daysUntil(startDate: string) {
  const [year, month, day] = startDate.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((start.getTime() - today.getTime()) / 86_400_000);
}

function AuthGate() {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <img className="brand-mark" src="/favicon.svg" alt="" />
        <p className="eyebrow">A LITTLE WINTER MAGIC</p>
        <h1>Your family countdown starts here.</h1>
        <p className="auth-copy">Log in or create an account as the grown-up to set up your private planner, choose daily ideas, and tuck away rewards for later.</p>
        <div className="auth-assurances"><span><LockKeyhole size={16} /> Parent-controlled</span><span><Heart size={16} /> Kindness first</span></div>
        <AuthForm />
        <p className="auth-footnote">Children don’t need their own account. Use a nickname rather than personal details.</p>
      </section>
      <div className="auth-art"><img src={CHILD_IMAGE} alt="A cheerful winter helper elf holding a golden star" onError={event => { if (!event.currentTarget.dataset.fallback) { event.currentTarget.dataset.fallback = "true"; event.currentTarget.src = FALLBACK_HERO_IMAGE; } }} /></div>
    </main>
  );
}

function CalendarCard({
  day,
  selected,
  startDate,
  hasReward,
  onClick,
  completionBusy,
  onToggleCompletion,
}: {
  day: PlannerDay;
  selected: boolean;
  startDate: string;
  hasReward: boolean;
  onClick: () => void;
  completionBusy: boolean;
  onToggleCompletion: () => void;
}) {
  const behaviourTarget = day.habitPrompt?.trim() ?? "";
  const dayLabel = String(day.dayNumber).padStart(2, "0");
  return (
    <article className={`day-card adult-day-card ${selected ? "is-selected" : ""} ${day.completed ? "is-complete" : ""}`}>
      <button type="button" className="day-card-select" onClick={onClick} aria-pressed={selected}>
        <span className="day-card-top"><span className="day-number">{dayLabel}</span>{day.completed ? <span className="day-complete"><Check size={13} /></span> : <span className="day-open-dot" />}</span>
        <span className="day-date">{shortDate(startDate, day.dayNumber)}</span>
        <span className="day-card-footer">{day.completed ? <><Star size={14} fill="currentColor" /> A little star</> : hasReward ? <><Gift size={14} /> Surprise saved</> : <><Sparkles size={14} /> Open day</>}</span>
      </button>
      <label className={`day-card-check ${day.completed ? "is-checked" : ""} ${!behaviourTarget && !day.completed ? "is-disabled" : ""}`}>
        <input type="checkbox" checked={day.completed} disabled={completionBusy || (!behaviourTarget && !day.completed)} onChange={onToggleCompletion} aria-label={behaviourTarget ? `Check off Day ${dayLabel} good behaviour: ${behaviourTarget}` : `Add behaviour to Day ${dayLabel} before checking it off`} />
        <span>{day.completed ? "Gold star earned" : behaviourTarget ? "Check off good deed" : "Add behaviour first"}</span>
      </label>
    </article>
  );
}

function StoryIdeaLibrary({ mode }: { mode: "stories" | "ideas" }) {
  const [activeStory, setActiveStory] = useState<Story | null>(null);
  const [filter, setFilter] = useState("All ideas");
  const filters = ["All ideas", "2 minutes", "Kindness", "Helping", "Calm", "Imagination"];
  const filteredIdeas = ideas.filter(idea => filter === "All ideas" || idea.time === filter || idea.tag === filter);

  if (mode === "stories") return (
    <section className="library-wrap">
      <div className="section-heading"><div><p className="eyebrow">THE STORY NOOK</p><h2>Little stories for cosy moments</h2><p>Short, original read-alouds about kindness, helping, and making room for rest.</p></div><BookOpen className="heading-icon" size={30} /></div>
      <div className="story-grid">
        {stories.map(story => <article className="story-card" key={story.title}>
          <span className="story-ribbon"><BookOpen size={14} /> {story.theme}</span>
          <h3>{story.title}</h3><p>{story.text.slice(0, 135)}…</p>
          <div className="story-card-bottom"><span><Clock3 size={14} /> {story.readTime}</span><button className="text-button" onClick={() => setActiveStory(story)}>Read together <ChevronRight size={16} /></button></div>
        </article>)}
      </div>
      {activeStory && <div className="modal-backdrop" role="presentation" onClick={() => setActiveStory(null)}>
        <article className="story-modal" role="dialog" aria-modal="true" aria-labelledby="story-title" onClick={event => event.stopPropagation()}>
          <button className="icon-button modal-close" aria-label="Close story" onClick={() => setActiveStory(null)}><X size={20} /></button>
          <p className="eyebrow">A STORY TO SHARE · {activeStory.readTime.toUpperCase()}</p><h2 id="story-title">{activeStory.title}</h2><p className="story-full">{activeStory.text}</p><div className="story-end"><Star size={18} fill="currentColor" /> The end — and a little kindness to take with you.</div>
        </article>
      </div>}
    </section>
  );

  return (
    <section className="library-wrap">
      <div className="section-heading"><div><p className="eyebrow">THE ELF IDEA DRAWER</p><h2>Small ideas, ready when you are</h2><p>Pick a tiny activity that fits your time, energy, and family today.</p></div><Lightbulb className="heading-icon" size={30} /></div>
      <div className="filter-row" role="group" aria-label="Filter elf ideas">
        {filters.map(item => <button key={item} className={`filter-chip ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}
      </div>
      <div className="ideas-grid">{filteredIdeas.map(idea => <article className="idea-card" key={idea.title}>
        <div className="idea-meta"><span className="idea-tag">{idea.tag}</span><span><Clock3 size={13} /> {idea.time}</span></div><h3>{idea.title}</h3><p>{idea.detail}</p>
      </article>)}</div>
      <p className="gentle-note"><Heart size={16} /> Choose what works for your family. Skipping or changing an idea is always okay.</p>
    </section>
  );
}

function RewardManager({
  days,
  rewards,
  templates,
  startDate,
  saving,
  saveReward,
  removeImage,
  deleteReward,
  updateTemplate,
  deleteTemplate,
}: {
  days: PlannerDay[];
  rewards: PlannerReward[];
  templates: PlannerRewardTemplate[];
  startDate: string;
  saving: boolean;
  saveReward: (dayNumber: number, label: string, imageData: string | null, templateId: number | null, saveAsTemplate: boolean) => void;
  removeImage: (dayNumber: number) => void;
  deleteReward: (dayNumber: number) => void;
  updateTemplate: (id: number, label: string, imageData: string) => void;
  deleteTemplate: (id: number) => void;
}) {
  const [selectedDay, setSelectedDay] = useState(days[0]?.dayNumber ?? 1);
  const reward = rewards.find(item => item.dayNumber === selectedDay);
  const [label, setLabel] = useState("");
  const [imageData, setImageData] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [uploading, setUploading] = useState(false);
  const day = days.find(item => item.dayNumber === selectedDay);
  const previousDay = days.find(item => item.dayNumber === selectedDay - 1);
  const isUnlocked = selectedDay === 1 || Boolean(previousDay?.completed);
  const pictureCount = rewards.filter(item => Boolean(item.imageData)).length;

  useEffect(() => {
    if (days.length && !days.some(item => item.dayNumber === selectedDay)) setSelectedDay(days[0].dayNumber);
  }, [days, selectedDay]);

  useEffect(() => {
    setLabel(reward?.label ?? "");
    setImageData(reward?.imageData ?? null);
    setTemplateId(reward?.templateId ?? null);
    setSaveAsTemplate(false);
  }, [selectedDay, reward?.label, reward?.imageData, reward?.templateId]);

  async function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setImageData(await compressImage(file));
      toast.success("Matching elf picture ready. Save the day reward or reusable template to keep it private.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That image could not be prepared.");
    } finally { setUploading(false); }
  }

  function applyTemplate(template: RewardTemplateItem) {
    setLabel(template.label);
    setImageData(template.imageData);
    setTemplateId(template.id);
    setSaveAsTemplate(false);
    toast.success(`Template ready for Day ${String(selectedDay).padStart(2, "0")}. Save the day reward to apply it.`);
  }

  return (
    <section className="library-wrap">
      <div className="section-heading"><div><p className="eyebrow">PARENT REWARD PANTRY</p><h2>Little surprises, your way</h2><p>Add a treat and its matching elf picture. Day 1 is ready from the start; each later treat appears automatically after the previous good deed is checked off.</p><p className="reward-image-progress">Matching pictures saved for {pictureCount} of {days.length} active days.</p></div><Gift className="heading-icon" size={30} /></div>
      <div className="reward-layout">
        <div className="reward-day-list"><p className="small-label">CHOOSE A DAY</p>{days.map(item => {
          const itemReward = rewards.find(entry => entry.dayNumber === item.dayNumber);
          return <button type="button" className={`reward-day-row ${selectedDay === item.dayNumber ? "active" : ""}`} key={item.dayNumber} disabled={uploading || saving} onClick={() => setSelectedDay(item.dayNumber)}>
            <span className="reward-day-number">{String(item.dayNumber).padStart(2, "0")}</span><span className="reward-day-copy"><strong>{shortDate(startDate, item.dayNumber)}</strong><small>{itemReward?.label ?? "No reward added yet"}</small><small className="reward-day-image-status">{itemReward?.imageData ? "Matching picture saved" : itemReward ? "Add a matching picture" : "Add treat + picture"}</small></span>{itemReward ? <Gift size={16} /> : <Plus size={16} />}
          </button>;
        })}</div>
        <div className="reward-editor">
          <div className="reward-day-jump"><label className="field-label" htmlFor="reward-day-jump">Jump directly to any of the {days.length} active days</label><select id="reward-day-jump" className="text-input" value={selectedDay} disabled={uploading || saving} onChange={event => setSelectedDay(Number(event.target.value))}>{days.map(item => <option key={item.dayNumber} value={item.dayNumber}>Day {String(item.dayNumber).padStart(2, "0")} · {shortDate(startDate, item.dayNumber)}</option>)}</select><small>Every active day can have its own treat and matching elf picture.</small></div>
          <div className="reward-editor-heading"><span className="round-icon"><Gift size={18} /></span><div><p className="eyebrow">DAY {String(selectedDay).padStart(2, "0")}</p><h3>{day ? shortDate(startDate, selectedDay) : "Choose a day"}</h3></div></div>
          <div className={`reward-unlock-note ${isUnlocked ? "is-unlocked" : "is-locked"}`}><span className="round-icon">{isUnlocked ? <Sparkles size={16} /> : <LockKeyhole size={16} />}</span><div><strong>{reward ? isUnlocked ? "This treat is ready for child view" : "This treat is tucked away for now" : "Add a treat for this day"}</strong><small>{selectedDay === 1 ? "Day 1 appears when the countdown begins." : `Automatically unlocks when Day ${String(selectedDay - 1).padStart(2, "0")} is checked off.`}</small></div><span className="unlock-status">{isUnlocked ? "READY" : "LOCKED"}</span></div>
          <label className="field-label" htmlFor="reward-label">Reward or treat</label>
          <input id="reward-label" className="text-input" value={label} maxLength={180} disabled={uploading || saving} onChange={event => setLabel(event.target.value)} placeholder="e.g. choose tonight's story" />
          <p className="field-hint">Try a family activity, a favourite story, or a small treat you have checked is suitable.</p>
          <div className="upload-box">
            {imageData ? <img className="reward-preview" src={imageData} alt="Matching elf picture preview for this treat" /> : <span className="upload-placeholder"><Upload size={20} /><span>Matching elf picture</span></span>}
            <div className="upload-actions"><label className="button button-soft upload-label">{uploading ? <Loader2 className="spin" size={16} /> : <Upload size={16} />} {imageData ? "Replace elf picture" : "Add elf picture"}<input type="file" accept="image/*" onChange={onImageChange} disabled={uploading || saving} /></label>{imageData && <button className="text-button muted" onClick={() => { setImageData(null); setTemplateId(null); setSaveAsTemplate(false); if (reward) removeImage(selectedDay); }} disabled={uploading || saving}>Remove picture</button>}</div>
          </div>
          <p className="privacy-callout"><ShieldCheck size={16} /> The treat and matching picture stay private until this day unlocks automatically. Add planner artwork only—never a child’s photo.</p>
          <label className={`template-save-toggle ${!imageData ? "is-disabled" : ""}`}><input type="checkbox" checked={saveAsTemplate} disabled={!imageData || uploading || saving} onChange={event => setSaveAsTemplate(event.target.checked)} /><span><strong>Save the treat + elf picture as a reusable template</strong><small>{imageData ? "Use this pair again on another day; edit the saved template any time." : "Add a matching elf picture to save a reusable template."}</small></span></label>
          <button className="button button-primary" disabled={!label.trim() || uploading || saving || (saveAsTemplate && !imageData)} onClick={() => saveReward(selectedDay, label.trim(), imageData, templateId, saveAsTemplate)}>{saving ? <Loader2 className="spin" size={17} /> : <Check size={17} />} Save reward for Day {String(selectedDay).padStart(2, "0")}</button>
          {reward && <button className="danger-text" disabled={uploading || saving} onClick={() => deleteReward(selectedDay)}><Trash2 size={15} /> Delete this reward and its picture</button>}
        </div>
      </div>
      <RewardTemplateLibrary templates={templates} selectedDay={selectedDay} busy={uploading || saving} onUse={applyTemplate} onUpdate={updateTemplate} onDelete={deleteTemplate} />
    </section>
  );
}

function PrivacyPanel({ onDelete, onChangePin, onDownloadBackup, backupBusy }: { onDelete: () => void; onChangePin: (pin: string) => void; onDownloadBackup: () => void; backupBusy: boolean }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newPin, setNewPin] = useState("");
  return (
    <section className="library-wrap">
      <div className="section-heading"><div><p className="eyebrow">FAMILY PRIVACY</p><h2>Your family’s little corner</h2><p>Only the signed-in parent who unlocks with the grown-up PIN can manage this planner. Use a nickname and keep uploads to reward/treat pictures.</p></div><ShieldCheck className="heading-icon" size={30} /></div>
      <div className="privacy-grid">
        <article className="privacy-card"><span className="round-icon"><LockKeyhole size={19} /></span><h3>Parent-owned access</h3><p>Parents sign in with Manus and unlock parent controls with a six-digit PIN. Children use a read-only view without a child login, public profile, or shared leaderboard.</p></article>
        <article className="privacy-card"><span className="round-icon"><Gift size={19} /></span><h3>Reward images stay private</h3><p>Matching elf pictures and reusable reward templates stay with your family. The child view receives a reward only when its day unlocks: Day 1 at the start, then after the previous good deed is checked off.</p></article>
        <article className="privacy-card"><span className="round-icon"><Heart size={19} /></span><h3>Good days aren’t a test</h3><p>Stars celebrate effort and moments together. There are no missed-day penalties, “naughty” labels, comparisons, or public scores.</p></article>
      </div>
      <div className="pin-change-panel"><div className="pin-change-copy"><span className="round-icon"><Download size={19} /></span><div><h3>Keep a copy of your family planner</h3><p>Download your saved rewards, pictures, templates, day settings and stars, including later days outside your current countdown. This does not change your planner.</p><p>This private JSON file is not encrypted. Keep it somewhere safe and download a fresh copy after changes. It excludes PINs, login keys, app code, audio and external bucket files. There is no one-click restore yet.</p></div></div><button type="button" className="button button-primary" onClick={onDownloadBackup} disabled={backupBusy}>{backupBusy ? <Loader2 size={17} className="spin" /> : <Download size={17} />} {backupBusy ? "Preparing backup…" : "Download family backup"}</button></div>
      <div className="pin-change-panel"><div className="pin-change-copy"><span className="round-icon"><LockKeyhole size={18} /></span><div><h3>Change grown-up PIN</h3><p>Choose a new six-digit code while parent mode is unlocked.</p></div></div><form className="pin-change-form" onSubmit={event => { event.preventDefault(); if (/^\d{6}$/.test(newPin)) { onChangePin(newPin); setNewPin(""); } }}><label className="field-label" htmlFor="new-parent-pin">New six-digit PIN</label><input id="new-parent-pin" className="text-input pin-input" type="password" inputMode="numeric" autoComplete="new-password" pattern="[0-9]{6}" minLength={6} maxLength={6} value={newPin} onChange={event => setNewPin(event.target.value.replace(/\D/g, "").slice(0, 6))} required /><button className="button button-soft" disabled={newPin.length !== 6}>Change PIN</button></form></div>
      <div className="delete-panel"><div><h3>Delete this family planner</h3><p>This removes the child display name, day entries, progress, reward labels, reusable templates, and uploaded reward/template images from the active planner data. A minimal deletion marker and your grown-up PIN remain to prevent accidental reseeding and keep any fresh planner protected. Platform backup retention is separate.</p></div>
        {!confirmDelete ? <button className="button button-danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Delete planner data</button> : <div className="confirm-actions"><span>Delete all family planner content?</span><button className="button button-danger" onClick={onDelete}>Yes, delete it</button><button className="button button-soft" onClick={() => setConfirmDelete(false)}>Cancel</button></div>}
      </div>
    </section>
  );
}

function FinalDayAudio() {
  return (
    <aside className="santa-audio-card" aria-labelledby="santa-audio-title">
      <div className="santa-audio-heading">
        <span className="round-icon gold-bg"><Star size={17} fill="currentColor" /></span>
        <div>
          <p className="eyebrow">A FINAL-DAY SURPRISE</p>
          <h3 id="santa-audio-title">Santa has a message for you!</h3>
          <p>Tap play to hear your congratulations.</p>
        </div>
      </div>
      <audio controls preload="none" aria-labelledby="santa-audio-title">
        <source src={SANTA_AUDIO_URL} type="audio/mpeg" />
        Your browser does not support audio playback.
      </audio>
    </aside>
  );
}

function ChildExperience({ data, selectedDay, setSelectedDay, onExit, onRefresh, refreshing }: {
  data: ChildView;
  selectedDay: number;
  setSelectedDay: (day: number) => void;
  onExit: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const planner = data.planner;
  const chimeAudioRef = useRef<HTMLAudioElement>(null);
  function playChristmasChime() {
    const audio = chimeAudioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => toast.error("The Christmas chime could not play. Please try again."));
  }
  const days = planner ? data.days.filter(day => day.dayNumber <= planner.countdownLength) : [];
  const activeDay = days.find(day => day.dayNumber === selectedDay) ?? days[0];
  const dayTreat = activeDay && data.rewards.find(reward => reward.dayNumber === activeDay.dayNumber);
  const previousDay = activeDay && days.find(day => day.dayNumber === activeDay.dayNumber - 1);
  const nextDay = activeDay && days.find(day => day.dayNumber === activeDay.dayNumber + 1);
  const nextDayTreat = nextDay && data.rewards.find(reward => reward.dayNumber === nextDay.dayNumber);
  const stars = days.filter(day => day.completed).length;
  const remainingStars = Math.max(0, (planner?.countdownLength ?? 0) - stars);
  if (!planner || planner.isDeleted) return <div className="empty-family"><span className="round-icon"><Sparkles size={20} /></span><h2>Your countdown is having a little rest.</h2><p>Ask your grown-up to set it up again whenever you’re ready.</p></div>;
  return (
    <main className="child-experience">
      <audio ref={chimeAudioRef} src="/audio/christmas-sleigh-bells.mp3" preload="none" aria-hidden="true" hidden />
      <div className="child-toolbar"><span><Sparkles size={16} /> YOUR MAGICAL COUNTDOWN</span><div className="child-toolbar-actions"><button type="button" className="button button-soft" onClick={playChristmasChime} aria-label="Play a Christmas chime" title="Play a Christmas chime"><Bell size={16} /> Play chime</button><button type="button" className="button button-soft" onClick={onRefresh} disabled={refreshing} aria-label="Refresh stars and treats" title="Refresh stars and treats"><RefreshCw size={16} className={refreshing ? "spin" : ""} /> Refresh</button><button type="button" className="button button-soft" onClick={onExit}><Users size={16} /> Grown-up view</button></div></div>
      <section className="child-welcome"><img src={CHILD_IMAGE} alt="A friendly winter helper elf offering a golden star" onError={event => { if (!event.currentTarget.dataset.fallback) { event.currentTarget.dataset.fallback = "true"; event.currentTarget.src = FALLBACK_HERO_IMAGE; } }} /><div className="child-welcome-copy"><p className="eyebrow">A LITTLE MAGIC, EVERY DAY</p><h1>{planner.childDisplayName}’s Good Deeds</h1><p>Kindness, cosy ideas, and little moments to share.</p><div className="child-stars" aria-live="polite" aria-atomic="true"><span className="star-orbit" key={stars}><Star size={18} fill="currentColor" /></span><strong>{remainingStars}</strong><span>{remainingStars === 1 ? "gold star left" : "gold stars left"}</span><small className="child-stars-earned">{stars} gold stars earned</small></div><div className="child-star-progress" role="progressbar" aria-label="Good deed stars earned" aria-valuemin={0} aria-valuemax={planner.countdownLength} aria-valuenow={stars}><span style={{ width: `${planner.countdownLength ? (stars / planner.countdownLength) * 100 : 0}%` }} /></div></div></section>
      <section className="child-calendar"><div className="child-section-title"><div><p className="eyebrow">YOUR COUNTDOWN</p><h2>Choose a day to visit</h2></div><span className="countdown-pill"><CalendarDays size={15} /> {planner.countdownLength} days</span></div><div className="calendar-grid child-grid">{days.map(day => <button key={day.dayNumber} className={`day-card child-day ${day.dayNumber === activeDay?.dayNumber ? "is-selected" : ""} ${day.completed ? "is-complete" : ""}`} onClick={() => setSelectedDay(day.dayNumber)}>
        <span className="day-card-top"><span className="day-number">{String(day.dayNumber).padStart(2, "0")}</span>{day.completed ? <span className="day-complete"><Check size={13} /></span> : <span className="day-open-dot" />}</span><span className="day-date">{shortDate(planner.startDate, day.dayNumber)}</span><span className="day-card-footer">{day.completed ? <><Star size={14} fill="currentColor" /> A star!</> : <><Sparkles size={14} /> A little idea</>}</span>
      </button>)}</div></section>
      {activeDay && <section className="child-magic-card"><div className="magic-card-label"><Sparkles size={15} /> DAY {String(activeDay.dayNumber).padStart(2, "0")} · {shortDate(planner.startDate, activeDay.dayNumber)}</div><blockquote>“{activeDay.elfNote}”</blockquote><div className="child-activity"><span className="activity-spark"><Lightbulb size={17} /></span><div><strong>A little idea</strong><p>{activeDay.activity}</p></div></div>{activeDay.habitPrompt && <div className="child-habit"><Heart size={16} /><span>Today’s good behaviour: <strong>{activeDay.habitPrompt}</strong></span></div>}
        {dayTreat ? <div className="revealed-surprise"><span className="round-icon"><Gift size={18} /></span><div><small>DAY {String(activeDay.dayNumber).padStart(2, "0")} TREAT</small><strong>{dayTreat.label}</strong><img src={dayTreat.imageData ?? CHILD_IMAGE} alt={dayTreat.imageData ? `Matching elf picture for ${dayTreat.label}` : "Your magical elf with a surprise"} /></div></div> : <div className="child-kind-note"><Star size={18} fill="currentColor" /><span>{activeDay.dayNumber > 1 && !previousDay?.completed ? `This day’s treat appears after Day ${String(activeDay.dayNumber - 1).padStart(2, "0")} is checked off.` : "Your grown-up has not added a treat for this day yet. Your good deed still earns its star."}</span></div>}
        {activeDay.dayNumber === planner.countdownLength && activeDay.completed && <FinalDayAudio />}
      </section>}
      {activeDay && nextDay && <section className="next-treat-card" aria-live="polite" aria-atomic="true"><div className="next-treat-heading"><span className="round-icon gold-bg"><Gift size={17} /></span><div><p className="eyebrow">NEXT DAY’S TREAT · DAY {String(nextDay.dayNumber).padStart(2, "0")}</p><strong>{shortDate(planner.startDate, nextDay.dayNumber)}</strong></div></div>{activeDay.completed ? nextDayTreat ? <div className="next-treat-reward"><img src={nextDayTreat.imageData ?? CHILD_IMAGE} alt={nextDayTreat.imageData ? `Matching elf picture for ${nextDayTreat.label}` : "Your magical elf with the next surprise"} /><div><small>UNLOCKED FOR YOUR NEXT COUNTDOWN DAY</small><strong>{nextDayTreat.label}</strong></div></div> : <p className="next-treat-message">Your grown-up has not added a treat for Day {String(nextDay.dayNumber).padStart(2, "0")} yet. The day is still full of lovely little ideas.</p> : <p className="next-treat-message">Check off Day {String(activeDay.dayNumber).padStart(2, "0")} together to see the treat and elf picture waiting for Day {String(nextDay.dayNumber).padStart(2, "0")}.</p>}</section>}
      <p className="child-footer-note">There’s no wrong way to enjoy a countdown. Rest days count, too.</p>
    </main>
  );
}

export default function ElfPlanner() {
  const auth = useAuth();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"parent" | "child">("parent");
  const [parentUnlocked, setParentUnlocked] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("countdown");
  const [selectedDay, setSelectedDay] = useState(1);
  const [settings, setSettings] = useState({ childDisplayName: "Little Helper", countdownLength: 12 as CountdownLength, startDate: "2026-12-01" });
  const [dayDraft, setDayDraft] = useState({ elfNote: "", activity: "", habitPrompt: "" });
  const [editingDay, setEditingDay] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [optimisticCompletion, setOptimisticCompletion] = useState<{ dayNumber: number; completed: boolean } | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const backupControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => { backupControllerRef.current?.abort(); }, []);

  const pinStatusQuery = trpc.planner.pinStatus.useQuery(undefined, { enabled: auth.isAuthenticated, retry: false });
  const overviewQuery = trpc.planner.overview.useQuery(undefined, { enabled: auth.isAuthenticated && parentUnlocked && mode === "parent", retry: false });
  const childQuery = trpc.planner.childView.useQuery(undefined, { enabled: auth.isAuthenticated && mode === "child", retry: false, refetchOnWindowFocus: true, refetchInterval: auth.isAuthenticated && mode === "child" ? 8_000 : false });
  const templatesQuery = trpc.planner.listRewardTemplates.useQuery(undefined, { enabled: auth.isAuthenticated && parentUnlocked && mode === "parent" && activeTab === "rewards", retry: false });
  const overview = overviewQuery.data;
  const planner = overview?.planner;
  const activeDays = useMemo(() => planner && overview ? overview.days.filter(day => day.dayNumber <= planner.countdownLength) : [], [planner, overview]);
  const activeRewards = useMemo(() => planner && overview ? overview.rewards.filter(reward => reward.dayNumber <= planner.countdownLength) : [], [planner, overview]);
  const selected = activeDays.find(day => day.dayNumber === selectedDay) ?? activeDays[0];
  const selectedReward = activeRewards.find(reward => reward.dayNumber === selected?.dayNumber);
  const selectedRewardUnlocked = selectedReward && (selectedReward.dayNumber === 1 || Boolean(activeDays.find(day => day.dayNumber === selectedReward.dayNumber - 1)?.completed));
  const completeCount = activeDays.filter(day => day.completed).length;
  const countdownTotal = planner?.countdownLength ?? settings.countdownLength;
  const optimisticDay = optimisticCompletion ? activeDays.find(day => day.dayNumber === optimisticCompletion.dayNumber) : undefined;
  const optimisticDelta = optimisticDay && optimisticCompletion ? Number(optimisticCompletion.completed) - Number(optimisticDay.completed) : 0;
  const displayedCompleteCount = Math.max(0, Math.min(countdownTotal, completeCount + optimisticDelta));
  const remainingStars = Math.max(0, countdownTotal - displayedCompleteCount);
  const dateGap = planner ? daysUntil(planner.startDate) : 0;

  useEffect(() => {
    if (!planner) return;
    setSettings({
      childDisplayName: planner.childDisplayName,
      countdownLength: planner.countdownLength === 24 ? 24 : 12,
      startDate: planner.startDate,
    });
  }, [planner?.id, planner?.childDisplayName, planner?.countdownLength, planner?.startDate]);

  useEffect(() => {
    if (!selected) return;
    setDayDraft({ elfNote: selected.elfNote, activity: selected.activity, habitPrompt: selected.habitPrompt ?? "" });
    setEditingDay(false);
  }, [selected?.id, selected?.elfNote, selected?.activity, selected?.habitPrompt]);

  useEffect(() => {
    if (!parentUnlocked) return;
    const timeout = window.setTimeout(() => {
      backupControllerRef.current?.abort();
      queryClient.removeQueries({ queryKey: [["planner", "overview"]] });
      queryClient.removeQueries({ queryKey: [["planner", "listRewardTemplates"]] });
      setParentUnlocked(false);
    }, 55 * 60 * 1000);
    return () => window.clearTimeout(timeout);
  }, [parentUnlocked, queryClient]);

  async function refreshPlanner() {
    await Promise.all([utils.planner.overview.invalidate(), utils.planner.childView.invalidate()]);
  }

  const settingsMutation = trpc.planner.updateSettings.useMutation({
    onSuccess: async () => { await refreshPlanner(); toast.success("Your countdown settings are saved."); },
    onError: error => toast.error(error.message),
  });
  const dayMutation = trpc.planner.updateDay.useMutation({
    onSuccess: async result => { await refreshPlanner(); setEditingDay(false); toast.success(result.completionReset ? "Behaviour updated. Check it off again to earn the gold star." : "That day is ready."); },
    onError: error => toast.error(error.message),
  });
  const completionMutation = trpc.planner.setCompleted.useMutation({
    onSuccess: async (_data, variables) => { await refreshPlanner(); setOptimisticCompletion(null); toast.success(variables.completed ? "Good behaviour checked off. A gold star and tomorrow’s treat are unlocked." : "Good behaviour unchecked. Tomorrow’s treat is tucked away again."); },
    onError: error => { setOptimisticCompletion(null); void refreshPlanner(); toast.error(error.message); },
  });
  const rewardMutation = trpc.planner.saveReward.useMutation({
    onSuccess: async () => { await Promise.all([refreshPlanner(), utils.planner.listRewardTemplates.invalidate()]); toast.success("Day reward saved. Any reusable template is ready in your private pantry."); },
    onError: error => toast.error(error.message),
  });
  const updateTemplateMutation = trpc.planner.updateRewardTemplate.useMutation({
    onSuccess: async () => { await utils.planner.listRewardTemplates.invalidate(); toast.success("Reusable reward template updated. Reapply it to change an assigned day."); },
    onError: error => toast.error(error.message),
  });
  const deleteTemplateMutation = trpc.planner.deleteRewardTemplate.useMutation({
    onSuccess: async () => { await Promise.all([refreshPlanner(), utils.planner.listRewardTemplates.invalidate()]); toast.success("Template removed. Assigned day rewards keep their saved copies."); },
    onError: error => toast.error(error.message),
  });
  const removeImageMutation = trpc.planner.removeRewardImage.useMutation({
    onSuccess: async () => { await refreshPlanner(); toast.success("Reward picture removed."); },
    onError: error => toast.error(error.message),
  });
  const deleteRewardMutation = trpc.planner.deleteReward.useMutation({
    onSuccess: async () => { await refreshPlanner(); toast.success("Reward and its picture deleted."); },
    onError: error => toast.error(error.message),
  });
  const deleteFamilyMutation = trpc.planner.deleteFamily.useMutation({
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: [["planner", "childView"]] });
      queryClient.removeQueries({ queryKey: [["planner", "childView"]] });
      queryClient.removeQueries({ queryKey: [["planner", "listRewardTemplates"]] });
      await utils.planner.overview.invalidate();
      toast.success("Family planner data deleted.");
    },
    onError: error => toast.error(error.message),
  });
  const createFreshMutation = trpc.planner.createFresh.useMutation({
    onSuccess: async () => { await refreshPlanner(); setActiveTab("countdown"); toast.success("A fresh countdown is ready for you."); },
    onError: error => toast.error(error.message),
  });

  const setupPinMutation = trpc.planner.setupPin.useMutation({
    onSuccess: async () => { await pinStatusQuery.refetch(); setParentUnlocked(true); toast.success("Your grown-up PIN is set."); },
    onError: error => toast.error(error.message),
  });
  const unlockParentMutation = trpc.planner.unlockParent.useMutation({
    onSuccess: () => { setParentUnlocked(true); toast.success("Parent view unlocked."); },
    onError: error => toast.error(error.message),
  });
  const changePinMutation = trpc.planner.changePin.useMutation({
    onSuccess: () => toast.success("Your grown-up PIN has been changed."),
    onError: error => toast.error(error.message),
  });
  const lockParentMutation = trpc.planner.lockParent.useMutation();

  async function downloadFamilyBackup() {
    if (backupControllerRef.current) return;
    const controller = new AbortController();
    backupControllerRef.current = controller;
    setBackupBusy(true);
    try {
      const backup = await collectFamilyBackup(
        (input, signal) => utils.client.planner.downloadFamilyBackup.mutate(input, { signal }),
        controller.signal
      );
      if (controller.signal.aborted) return;
      downloadFamilyBackupFile(backup);
      toast.success("Backup download started. Check your browser’s Downloads folder and keep the file private.");
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : "Your backup could not be downloaded. Please try again.");
    } finally {
      if (backupControllerRef.current === controller) {
        backupControllerRef.current = null;
        setBackupBusy(false);
      }
    }
  }

  function signOut() {
    backupControllerRef.current?.abort();
    setParentUnlocked(false);
    setMode("parent");
    queryClient.removeQueries({ queryKey: [["planner", "overview"]] });
    queryClient.removeQueries({ queryKey: [["planner", "listRewardTemplates"]] });
    queryClient.removeQueries({ queryKey: [["planner", "childView"]] });
    void lockParentMutation.mutateAsync().catch(() => undefined).finally(() => {
      void auth.logout().catch(() => toast.error("Could not sign out."));
    });
  }

  async function enterChildMode() {
    backupControllerRef.current?.abort();
    try {
      await lockParentMutation.mutateAsync();
      await queryClient.cancelQueries({ queryKey: [["planner", "childView"]] });
      queryClient.removeQueries({ queryKey: [["planner", "childView"]] });
      queryClient.removeQueries({ queryKey: [["planner", "overview"]] });
      queryClient.removeQueries({ queryKey: [["planner", "listRewardTemplates"]] });
      setParentUnlocked(false);
      setMode("child");
    } catch {
      toast.error("Parent mode could not be locked. Please try again.");
    }
  }

  function returnToParentMode() {
    setMode("parent");
    setParentUnlocked(false);
  }

  if (auth.loading) return <div className="loading-screen"><Loader2 className="spin" size={28} /><p>Opening the little planner…</p></div>;
  if (!auth.isAuthenticated) return <AuthGate />;
  if (pinStatusQuery.isLoading) return <div className="loading-screen"><Loader2 className="spin" size={28} /><p>Checking grown-up access…</p></div>;
  if (pinStatusQuery.error || !pinStatusQuery.data) return <div className="loading-screen error-state"><ShieldCheck size={28} /><h2>We couldn’t check parent access.</h2><p>{pinStatusQuery.error?.message ?? "Please try again."}</p><button className="button button-primary" onClick={() => pinStatusQuery.refetch()}>Try again</button></div>;
  if (!pinStatusQuery.data.hasPin) return <ParentPinGate mode="setup" busy={setupPinMutation.isPending} onSubmit={pin => setupPinMutation.mutate({ pin })} onSignOut={signOut} />;

  if (mode === "child") {
    if (childQuery.isLoading) return <div className="loading-screen"><Loader2 className="spin" size={28} /><p>Unfolding the countdown…</p></div>;
    if (childQuery.error || !childQuery.data) return <div className="loading-screen error-state"><p>The countdown could not be opened right now.</p><button className="button button-soft" onClick={returnToParentMode}>Grown-up view</button></div>;
    return <ChildExperience data={childQuery.data} selectedDay={selectedDay} setSelectedDay={setSelectedDay} onExit={returnToParentMode} onRefresh={() => { void childQuery.refetch(); }} refreshing={childQuery.isFetching} />;
  }

  if (!parentUnlocked) return <ParentPinGate mode="unlock" busy={unlockParentMutation.isPending} onSubmit={pin => unlockParentMutation.mutate({ pin })} onSignOut={signOut} />;
  if (overviewQuery.isLoading) return <div className="loading-screen"><Loader2 className="spin" size={28} /><p>Preparing your family’s planner…</p></div>;
  if (overviewQuery.error) return <div className="loading-screen error-state"><ShieldCheck size={28} /><h2>We couldn’t open the planner.</h2><p>{overviewQuery.error.message}</p><button className="button button-primary" onClick={() => overviewQuery.refetch()}>Try again</button></div>;

  if (planner?.isDeleted) return (
    <div className="app-page"><header className="topbar"><a className="brand" href="/"><img src="/favicon.svg" alt="" /><span>MY ELF COUNTDOWN<small>FAMILY PLANNER</small></span></a><button className="icon-button" aria-label="Sign out" onClick={signOut}><LogOut size={18} /></button></header><main className="empty-family"><span className="round-icon"><Sparkles size={20} /></span><p className="eyebrow">A FRESH PAGE</p><h2>Your family planner has been cleared.</h2><p>The deleted planner content will stay cleared unless you choose to begin again.</p><button className="button button-primary" onClick={() => createFreshMutation.mutate()} disabled={createFreshMutation.isPending}><Plus size={17} /> Start a fresh countdown</button></main></div>
  );

  const navItems: Array<{ id: Tab; label: string; icon: typeof CalendarDays }> = [
    { id: "countdown", label: "Countdown", icon: CalendarDays },
    { id: "rewards", label: "Rewards & treats", icon: Gift },
    { id: "stories", label: "Story nook", icon: BookOpen },
    { id: "ideas", label: "Elf ideas", icon: Lightbulb },
    { id: "privacy", label: "Privacy", icon: ShieldCheck },
  ];

  function submitSettings(event: FormEvent) {
    event.preventDefault();
    settingsMutation.mutate(settings);
  }

  function saveDay(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const behaviourTarget = dayDraft.habitPrompt.trim();
    if (!behaviourTarget) {
      toast.error("Set a good-behaviour target for this day before saving it.");
      return;
    }
    dayMutation.mutate({
      dayNumber: selected.dayNumber,
      elfNote: dayDraft.elfNote.trim(),
      activity: dayDraft.activity.trim(),
      habitPrompt: behaviourTarget,
    });
  }

  function saveReward(dayNumber: number, label: string, imageData: string | null, templateId: number | null, saveAsTemplate: boolean) {
    rewardMutation.mutate({ dayNumber, label, imageData, templateId, saveAsTemplate });
  }

  function updateTemplate(id: number, label: string, imageData: string) {
    updateTemplateMutation.mutate({ templateId: id, label, imageData });
  }

  function deleteTemplate(id: number) {
    deleteTemplateMutation.mutate({ templateId: id });
  }

  function toggleDayCompletion(day: PlannerDay) {
    if (completionMutation.isPending || (!day.habitPrompt?.trim() && !day.completed)) return;
    const completed = !day.completed;
    setSelectedDay(day.dayNumber);
    setOptimisticCompletion({ dayNumber: day.dayNumber, completed });
    completionMutation.mutate({ dayNumber: day.dayNumber, completed, expectedHabitPrompt: day.habitPrompt });
  }

  function toggleSelectedCompletion() {
    if (selected) toggleDayCompletion(selected);
  }

  function deleteReward(dayNumber: number) {
    if (window.confirm("Delete this reward and its uploaded picture? This cannot be undone.")) deleteRewardMutation.mutate({ dayNumber });
  }

  function deleteFamily() {
    deleteFamilyMutation.mutate();
  }

  return (
    <div className="app-page">
      <header className="topbar">
        <a className="brand" href="/" aria-label="My Elf Countdown home"><img src="/manus-storage/async-images/27V2WxKsMY57Gr0gMsRiMb/image-2.webp" alt="" onError={event => { event.currentTarget.src = "/favicon.svg"; }} /><span>MY ELF COUNTDOWN<small>FAMILY PLANNER</small></span></a>
        <button className="mobile-menu-button icon-button" aria-label="Toggle navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? <X size={20} /> : <CalendarDays size={20} />}</button>
        <nav className={`top-nav ${mobileNavOpen ? "open" : ""}`} aria-label="Parent planner navigation">{navItems.map(item => { const Icon = item.icon; return <button key={item.id} className={`nav-link ${activeTab === item.id ? "active" : ""}`} onClick={() => { setActiveTab(item.id); setMobileNavOpen(false); }}><Icon size={16} /> {item.label}</button>; })}</nav>
        <div className="account-area"><span className="account-dot">{(auth.user?.name || "P").slice(0, 1).toUpperCase()}</span><span className="account-name">{auth.user?.name || "Parent"}</span><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={17} /></button></div>
      </header>

      <main className="app-content">
        <section className="welcome-banner">
          <div className="welcome-copy"><p className="eyebrow"><Sparkles size={14} /> A LITTLE MAGIC, ONE KIND MOMENT AT A TIME</p><h1>{settings.childDisplayName}’s<br className="desktop-break" /> Christmas countdown</h1><p className="welcome-subtitle">Make a little room for wonder, helpful hands, and cosy moments together.</p><div className="top-star-meter" aria-live="polite" aria-atomic="true"><span className="top-star-symbol" key={displayedCompleteCount}><Star size={21} fill="currentColor" /></span><div className="top-star-copy"><div className="top-star-headline"><strong>{remainingStars}</strong><span>{remainingStars === 0 ? "all stars gathered!" : remainingStars === 1 ? "star left to collect" : "stars left to collect"}</span></div><div className="top-star-caption">{displayedCompleteCount} of {countdownTotal} good deeds celebrated</div><div className="top-star-progress" role="progressbar" aria-label="Good deed stars earned" aria-valuemin={0} aria-valuemax={countdownTotal} aria-valuenow={displayedCompleteCount}><span style={{ width: `${countdownTotal ? (displayedCompleteCount / countdownTotal) * 100 : 0}%` }} /></div></div></div><button className="button button-light" onClick={enterChildMode}><Users size={16} /> Open child view <ChevronRight size={16} /></button></div>
          <div className="welcome-art"><img src={HERO_IMAGE} alt="A friendly red-suited winter elf with a glowing golden star in a snowy forest" onError={event => { if (!event.currentTarget.dataset.fallback) { event.currentTarget.dataset.fallback = "true"; event.currentTarget.src = FALLBACK_HERO_IMAGE; } }} /></div>
          <div className="banner-star star-one"><Star size={22} fill="currentColor" /></div><div className="banner-star star-two"><Star size={14} fill="currentColor" /></div>
        </section>

        {activeTab === "countdown" && <>
          <div className="dashboard-intro"><div><p className="eyebrow">YOUR FAMILY’S LITTLE PLANNER</p><h2>Let’s make the days feel special.</h2><p>Choose a day, add an idea, and celebrate whatever effort fits today.</p></div><div className="countdown-summary"><div className="summary-block"><span className="summary-icon"><CalendarDays size={17} /></span><strong>{settings.countdownLength}</strong><small>days planned</small></div><div className="summary-divider" /><div className="summary-block"><span className="summary-icon gold"><Star size={17} fill="currentColor" /></span><strong>{displayedCompleteCount}</strong><small>stars earned</small></div><div className="summary-divider" /><div className="summary-block"><span className="summary-icon blue"><Clock3 size={17} /></span><strong>{dateGap > 0 ? dateGap : dateGap === 0 ? "Today" : "Ready"}</strong><small>{dateGap > 0 ? "days to begin" : "countdown"}</small></div></div></div>
          <div className="workspace-grid">
            <div className="main-column">
              <section className="planner-board">
                <div className="planner-board-header"><div><p className="eyebrow">THE COUNTDOWN BOARD</p><h2>{settings.childDisplayName}’s Good Deeds</h2><p>Every little try earns a moment of celebration.</p></div><div className="season-mark"><span className="season-star"><Star size={20} fill="currentColor" /></span><span>{remainingStars}<small> stars left</small></span></div></div>
                <div className="calendar-grid">{activeDays.map(day => {
                  const displayDay = optimisticCompletion?.dayNumber === day.dayNumber ? { ...day, completed: optimisticCompletion.completed } : day;
                  return <CalendarCard key={day.dayNumber} day={displayDay} selected={selected?.dayNumber === day.dayNumber} startDate={planner?.startDate ?? settings.startDate} hasReward={activeRewards.some(reward => reward.dayNumber === day.dayNumber)} completionBusy={completionMutation.isPending} onClick={() => setSelectedDay(day.dayNumber)} onToggleCompletion={() => toggleDayCompletion(day)} />;
                })}</div>
                <p className="board-footnote"><Heart size={15} /> Rest days count. This chart celebrates effort, not perfection.</p>
              </section>

              <section className="day-detail-card">
                <div className="detail-topline"><span className="round-icon"><Sparkles size={17} /></span><div><p className="eyebrow">{selected ? `DAY ${String(selected.dayNumber).padStart(2, "0")} · ${shortDate(planner?.startDate ?? settings.startDate, selected.dayNumber)}` : "YOUR DAY"}</p><h2>{editingDay ? "Shape this little moment" : "Today’s little elf note"}</h2></div>{selected && <button className="icon-button detail-edit" title="Edit this day" onClick={() => setEditingDay(!editingDay)}>{editingDay ? <X size={17} /> : <Pencil size={17} />}</button>}</div>
                {selected && (editingDay ? <form className="day-editor" onSubmit={saveDay}>
                  <label className="field-label" htmlFor="elf-note">Elf note</label><textarea id="elf-note" className="text-input text-area" maxLength={500} value={dayDraft.elfNote} onChange={event => setDayDraft({ ...dayDraft, elfNote: event.target.value })} required />
                  <label className="field-label" htmlFor="day-activity">Low-prep idea</label><textarea id="day-activity" className="text-input text-area short" maxLength={500} value={dayDraft.activity} onChange={event => setDayDraft({ ...dayDraft, activity: event.target.value })} required />
                  <label className="field-label" htmlFor="habit-prompt">Good behaviour to complete for a gold star</label><input id="habit-prompt" className="text-input" maxLength={240} value={dayDraft.habitPrompt} onChange={event => setDayDraft({ ...dayDraft, habitPrompt: event.target.value })} placeholder="e.g. Put your shoes by the door after school" required /><p className="behaviour-guide">Choose one clear, kind behaviour. Check this day off after it is done to add a gold star and unlock tomorrow’s treat.</p>
                  <button className="button button-primary" disabled={dayMutation.isPending}><Check size={16} /> Save this day</button>
                </form> : <>
                  <blockquote className="elf-note">“{selected.elfNote}”</blockquote><div className="activity-box"><span className="activity-spark"><Lightbulb size={17} /></span><div><strong>A tiny idea</strong><p>{selected.activity}</p></div></div>{selected.habitPrompt && <div className="habit-chip"><Heart size={15} /> Good behaviour to complete: <strong>{selected.habitPrompt}</strong></div>}
                  <div className="parent-actions"><label className={`good-deed-check ${selected.completed ? "is-checked" : ""} ${!selected.habitPrompt?.trim() && !selected.completed ? "is-disabled" : ""}`}><input type="checkbox" checked={selected.completed} disabled={completionMutation.isPending || (!selected.habitPrompt?.trim() && !selected.completed)} onChange={toggleSelectedCompletion} aria-label={selected.completed ? "Uncheck completed good behaviour" : "Check off completed good behaviour"} /><span className="good-deed-check-box" aria-hidden="true">{selected.completed && <Check size={17} />}</span><span className="good-deed-check-copy"><strong>{selected.completed ? "Good behaviour checked off" : "Check off this good behaviour"}</strong><small>{selected.habitPrompt?.trim() ? `${selected.habitPrompt} — checking this adds a gold star and unlocks the next day’s treat.` : "Add a behaviour target in Edit this day before checking it off."}</small></span></label>{selected.completed && <span className="completed-caption">+1 gold star · next day’s treat unlocked</span>}</div>
                  {selectedReward && <div className="parent-reward-state"><span className="round-icon"><Gift size={16} /></span><div><strong>{selectedReward.label}</strong><small>{selectedRewardUnlocked ? "Visible in child view" : `Unlocks when Day ${String(selectedReward.dayNumber - 1).padStart(2, "0")} is checked off`}</small></div><button className="text-button" onClick={() => setActiveTab("rewards")}>Manage <ChevronRight size={15} /></button></div>}
                </>)}
              </section>
            </div>

            <aside className="sidebar-column">
              <section className="parent-setup-card"><div className="panel-heading"><span className="round-icon"><Pencil size={16} /></span><div><p className="eyebrow">GROWN-UP SETTINGS</p><h3>Your countdown setup</h3></div></div>
                <form onSubmit={submitSettings} className="settings-form"><label className="field-label" htmlFor="child-name">Child’s display name</label><input id="child-name" className="text-input" maxLength={80} value={settings.childDisplayName} onChange={event => setSettings({ ...settings, childDisplayName: event.target.value })} required /><p className="field-hint">A nickname is lovely. No full name needed.</p>
                  <span className="field-label">Countdown length</span><div className="choice-row" role="group" aria-label="Countdown length"><button type="button" className={settings.countdownLength === 12 ? "chosen" : ""} onClick={() => setSettings({ ...settings, countdownLength: 12 })}>12 days</button><button type="button" className={settings.countdownLength === 24 ? "chosen" : ""} onClick={() => setSettings({ ...settings, countdownLength: 24 })}>24 days</button></div>
                  <label className="field-label" htmlFor="start-date">First day</label><input id="start-date" className="text-input" type="date" value={settings.startDate} onChange={event => setSettings({ ...settings, startDate: event.target.value })} required />
                  <button className="button button-primary button-wide" disabled={settingsMutation.isPending}>{settingsMutation.isPending ? <Loader2 className="spin" size={16} /> : <Check size={16} />} Save setup</button>
                </form>
                <p className="privacy-callout small"><ShieldCheck size={15} /> Private to your signed-in parent account.</p>
              </section>
              <section className="gentle-reminder"><span className="reminder-icon"><Heart size={18} fill="currentColor" /></span><div><p className="eyebrow">A GENTLE REMINDER</p><h3>Connection comes first.</h3><p>Plans can change. Choose an idea that fits your family today, or enjoy a quiet day instead.</p></div></section>
              <button className="open-rewards-card" onClick={() => setActiveTab("rewards")}><span className="round-icon gold-bg"><Gift size={18} /></span><span><strong>Plan a little surprise</strong><small>Add a treat, story, or family moment</small></span><ChevronRight size={17} /></button>
            </aside>
          </div>
        </>}

        {activeTab === "rewards" && planner && <p className="field-hint">Your private planner reference: <strong>ELF-{planner.id}</strong></p>}
        {activeTab === "rewards" && <RewardManager days={activeDays} rewards={activeRewards} templates={templatesQuery.data ?? []} startDate={planner?.startDate ?? settings.startDate} saving={rewardMutation.isPending} saveReward={saveReward} removeImage={dayNumber => removeImageMutation.mutate({ dayNumber })} deleteReward={deleteReward} updateTemplate={updateTemplate} deleteTemplate={deleteTemplate} />}
        {activeTab === "stories" && <StoryIdeaLibrary mode="stories" />}
        {activeTab === "ideas" && <StoryIdeaLibrary mode="ideas" />}
        {activeTab === "privacy" && <PrivacyPanel onDelete={deleteFamily} onChangePin={pin => changePinMutation.mutate({ pin })} onDownloadBackup={() => { void downloadFamilyBackup(); }} backupBusy={backupBusy} />}
      </main>
      <footer className="site-footer"><span><img src="/favicon.svg" alt="" /> Made for little moments, not perfect days.</span><span>Adult-managed · Private family planner</span></footer>
    </div>
  );
}
