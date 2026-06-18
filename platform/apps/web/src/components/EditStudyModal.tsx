import { useState } from 'react';
import { Modal, BtnGhost, BtnPrimary, ModalMsg } from './ui/Modal';
import { updateStudy } from '../api';
import type { StudyDetail } from '../types';

interface Props {
  study: StudyDetail;
  onClose: () => void;
  onSaved: () => void;
}

export function EditStudyModal({ study, onClose, onSaved }: Props) {
  const ov = study.overview ?? {};
  const kb = study.knowledgeBank ?? {};

  const [name, setName] = useState(ov.name ?? study.name ?? '');
  const [internal, setInternal] = useState(ov.internalNumber ?? '');
  const [sponsor, setSponsor] = useState(ov.sponsor ?? study.sponsor ?? '');
  const [pi, setPi] = useState(ov.principalInvestigator ?? '');
  const [priority, setPriority] = useState(ov.priority ?? '');
  const [site, setSite] = useState(ov.site ?? '');
  const [indication, setIndication] = useState(ov.indication ?? study.indication ?? '');
  const [drug, setDrug] = useState(ov.drug ?? study.drug ?? '');

  const [kbGeneral, setKbGeneral] = useState(kb['General Study Information'] ?? '');
  const [kbDesign, setKbDesign] = useState(kb['Trial Design'] ?? '');
  const [kbComp, setKbComp] = useState(kb['Compensation / Reimbursement'] ?? '');
  const [kbBlind, setKbBlind] = useState(kb['Blinding'] ?? '');

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' | 'neutral' }>({ text: '', kind: 'neutral' });

  const handleSave = async () => {
    setSubmitting(true);
    setMsg({ text: 'Saving…', kind: 'neutral' });
    try {
      await updateStudy(study.id, {
        study: {
          name,
          internalNumber: internal,
          sponsor,
          principalInvestigator: pi,
          site,
          priority,
          indication,
          drug,
        },
        knowledgeBank: {
          'General Study Information': kbGeneral,
          'Trial Design': kbDesign,
          'Compensation / Reimbursement': kbComp,
          Blinding: kbBlind,
        },
      });
      setMsg({ text: 'Saved.', kind: 'ok' });
      onSaved();
      setTimeout(() => {
        onClose();
        setSubmitting(false);
      }, 900);
    } catch (e) {
      setMsg({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, kind: 'err' });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Edit Study Details"
      onClose={onClose}
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <BtnPrimary onClick={handleSave} disabled={submitting}>
            Save Changes
          </BtnPrimary>
        </>
      }
    >
      <label className="fld">
        <span>Study name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="fld-row">
        <label className="fld">
          <span>Internal #</span>
          <input type="text" value={internal} onChange={(e) => setInternal(e.target.value)} />
        </label>
        <label className="fld">
          <span>Sponsor</span>
          <input type="text" value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
        </label>
      </div>

      <div className="fld-row">
        <label className="fld">
          <span>Principal Investigator</span>
          <input
            type="text"
            placeholder="e.g. Jane Smith, MD"
            value={pi}
            onChange={(e) => setPi(e.target.value)}
          />
        </label>
        <label className="fld">
          <span>Priority</span>
          <input type="text" placeholder="e.g. Very High" value={priority} onChange={(e) => setPriority(e.target.value)} />
        </label>
      </div>

      <label className="fld">
        <span>Site (address · phone)</span>
        <input
          type="text"
          placeholder="e.g. Houston Metro, 123 Main St · (555) 123-4567"
          value={site}
          onChange={(e) => setSite(e.target.value)}
        />
      </label>

      <div className="fld-row">
        <label className="fld">
          <span>Indication</span>
          <input type="text" value={indication} onChange={(e) => setIndication(e.target.value)} />
        </label>
        <label className="fld">
          <span>Drug</span>
          <input type="text" value={drug} onChange={(e) => setDrug(e.target.value)} />
        </label>
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          color: 'var(--text-muted)',
          marginTop: 6,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
        }}
      >
        Knowledge Bank
      </div>

      <label className="fld">
        <span>General Study Information</span>
        <textarea rows={3} value={kbGeneral} onChange={(e) => setKbGeneral(e.target.value)} />
      </label>
      <label className="fld">
        <span>Trial Design</span>
        <textarea rows={2} value={kbDesign} onChange={(e) => setKbDesign(e.target.value)} />
      </label>
      <label className="fld">
        <span>Compensation / Reimbursement</span>
        <textarea rows={2} value={kbComp} onChange={(e) => setKbComp(e.target.value)} />
      </label>
      <label className="fld">
        <span>Blinding</span>
        <textarea rows={2} value={kbBlind} onChange={(e) => setKbBlind(e.target.value)} />
      </label>

      {msg.text && <ModalMsg text={msg.text} kind={msg.kind} />}
    </Modal>
  );
}
