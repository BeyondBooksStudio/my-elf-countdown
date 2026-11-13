import { useState, type ChangeEvent, type FormEvent } from "react";
import { Check, Loader2, Pencil, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { compressImage } from "@/lib/image";

export type RewardTemplateItem = {
  id: number;
  label: string;
  imageData: string;
  imageMime: string;
};

type Props = {
  templates: RewardTemplateItem[];
  selectedDay: number;
  busy: boolean;
  onUse: (template: RewardTemplateItem) => void;
  onUpdate: (id: number, label: string, imageData: string) => void;
  onDelete: (id: number) => void;
};

export default function RewardTemplateLibrary({ templates, selectedDay, busy, onUse, onUpdate, onDelete }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  function editTemplate(template: RewardTemplateItem) {
    setEditingId(template.id);
    setDraftLabel(template.label);
    setDraftImage(template.imageData);
    setConfirmDeleteId(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraftLabel("");
    setDraftImage(null);
    setUploading(false);
  }

  async function onImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      setDraftImage(await compressImage(file));
      toast.success("The matching elf picture is ready to save.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That image could not be prepared.");
    } finally {
      setUploading(false);
    }
  }

  function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (editingId === null || !draftLabel.trim() || !draftImage || uploading) return;
    onUpdate(editingId, draftLabel.trim(), draftImage);
    cancelEdit();
  }

  return (
    <section className="template-library" aria-labelledby="reward-template-heading">
      <div className="template-library-heading">
        <div>
          <p className="eyebrow">YOUR PRIVATE REWARD PANTRY</p>
          <h3 id="reward-template-heading">Saved reward templates</h3>
          <p>Reuse a treat-and-picture pair on any day. Editing a template will not change day rewards already assigned from it.</p>
        </div>
        <span className="round-icon"><Pencil size={17} /></span>
      </div>
      {templates.length === 0 ? (
        <div className="template-empty"><span className="round-icon"><Upload size={17} /></span><p>Save a reward with its matching elf picture to create your first reusable template.</p></div>
      ) : (
        <div className="template-grid">
          {templates.map(template => (
            <article className="template-card" key={template.id}>
              {editingId === template.id ? (
                <form className="template-edit-form" onSubmit={saveEdit}>
                  <label className="field-label" htmlFor={`template-label-${template.id}`}>Template reward</label>
                  <input id={`template-label-${template.id}`} className="text-input" maxLength={180} value={draftLabel} onChange={event => setDraftLabel(event.target.value)} required />
                  {draftImage && <img className="template-edit-preview" src={draftImage} alt={`Matching elf picture for ${draftLabel || template.label}`} />}
                  <label className="button button-soft upload-label template-replace-label">{uploading ? <Loader2 className="spin" size={15} /> : <Upload size={15} />} Replace matching picture<input type="file" accept="image/*" onChange={onImageChange} disabled={uploading || busy} /></label>
                  <div className="template-actions">
                    <button className="button button-primary" type="submit" disabled={!draftLabel.trim() || !draftImage || uploading || busy}><Check size={15} /> Save template</button>
                    <button className="button button-soft" type="button" onClick={cancelEdit}><X size={15} /> Cancel</button>
                  </div>
                </form>
              ) : (
                <>
                  <img className="template-card-image" src={template.imageData} alt={`Matching elf picture for ${template.label}`} />
                  <div className="template-card-content">
                    <strong>{template.label}</strong>
                    <small>Reward + elf picture</small>
                    <div className="template-actions">
                      <button className="button button-soft" onClick={() => onUse(template)} disabled={busy}><Check size={15} /> Use on Day {String(selectedDay).padStart(2, "0")}</button>
                      <button className="icon-button" aria-label={`Edit ${template.label} template`} title="Edit template" onClick={() => editTemplate(template)} disabled={busy}><Pencil size={16} /></button>
                      {confirmDeleteId === template.id ? (
                        <span className="template-delete-confirm"><small>Assigned days keep their copy.</small><button className="text-button danger-text" onClick={() => { onDelete(template.id); setConfirmDeleteId(null); }} disabled={busy}>Confirm delete</button><button className="text-button" onClick={() => setConfirmDeleteId(null)}>Cancel</button></span>
                      ) : <button className="icon-button danger-icon" aria-label={`Delete ${template.label} template`} title="Delete template" onClick={() => setConfirmDeleteId(template.id)} disabled={busy}><Trash2 size={16} /></button>}
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
