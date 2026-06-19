import { useState, useRef } from 'react';
import { Modal, BtnGhost, BtnPrimary, ModalMsg } from './ui/Modal';
import { createStudy } from '../api';

interface Props {
  onClose: () => void;
  onCreated: (id: string) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        resolve(result.split(',')[1] ?? '');
      } else {
        reject(new Error('Unexpected FileReader result type'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function NewStudyModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [internal, setInternal] = useState('');
  const [sponsor, setSponsor] = useState('');
  const [indication, setIndication] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; kind: 'ok' | 'err' | 'neutral' }>({ text: '', kind: 'neutral' });
  const protocolRef = useRef<HTMLInputElement>(null);
  const icfRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setMsg({ text: 'Study name is required.', kind: 'err' });
      return;
    }
    setSubmitting(true);
    setMsg({ text: 'Uploading & extracting…', kind: 'neutral' });

    try {
      const documents: Array<{ filename: string; type: string; dataBase64: string }> = [];

      const protocolFile = protocolRef.current?.files?.[0];
      if (protocolFile) {
        documents.push({
          filename: protocolFile.name,
          type: 'Protocol',
          dataBase64: await fileToBase64(protocolFile),
        });
      }

      const icfFile = icfRef.current?.files?.[0];
      if (icfFile) {
        documents.push({
          filename: icfFile.name,
          type: 'ICF',
          dataBase64: await fileToBase64(icfFile),
        });
      }

      const res = await createStudy({
        name: name.trim(),
        internalNumber: internal.trim() || undefined,
        sponsor: sponsor.trim() || undefined,
        indication: indication.trim() || undefined,
        documents,
      });

      setMsg({
        text: `Created "${res.id}" (${res.documents} doc${res.documents === 1 ? '' : 's'}). ${res.note ?? ''}`,
        kind: 'ok',
      });
      onCreated(res.id);
      setTimeout(() => onClose(), 1600);
    } catch (e) {
      setMsg({ text: `Error: ${e instanceof Error ? e.message : String(e)}`, kind: 'err' });
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Add New Study"
      onClose={onClose}
      footer={
        <>
          <BtnGhost onClick={onClose}>Cancel</BtnGhost>
          <BtnPrimary onClick={handleSubmit} disabled={submitting}>
            Upload &amp; Create
          </BtnPrimary>
        </>
      }
    >
      <label className="fld">
        <span>Study name <i style={{ color: 'var(--red)', fontStyle: 'normal' }}>*</i></span>
        <input
          type="text"
          placeholder="e.g. WC45920 (CT-401)_Asthma"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="fld-row">
        <label className="fld">
          <span>Internal #</span>
          <input type="text" placeholder="WC45920" value={internal} onChange={(e) => setInternal(e.target.value)} />
        </label>
        <label className="fld">
          <span>Sponsor</span>
          <input type="text" placeholder="Sponsor name" value={sponsor} onChange={(e) => setSponsor(e.target.value)} />
        </label>
      </div>

      <label className="fld">
        <span>Indication</span>
        <input type="text" placeholder="Condition / population" value={indication} onChange={(e) => setIndication(e.target.value)} />
      </label>

      <label className="fld upload">
        <span>Protocol PDF</span>
        <input ref={protocolRef} type="file" accept="application/pdf" />
      </label>

      <label className="fld upload">
        <span>ICF PDF (optional)</span>
        <input ref={icfRef} type="file" accept="application/pdf" />
      </label>

      {msg.text && <ModalMsg text={msg.text} kind={msg.kind} />}
    </Modal>
  );
}
