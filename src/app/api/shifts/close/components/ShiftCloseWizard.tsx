'use client';
import { useState, useEffect, useRef } from 'react';
import localforage from 'localforage';

interface Pump {
  id: string;
  pump_number: number;
  fuel_grade: string;
  nozzle_label: string;
}

interface Draft {
  shiftId: string;
  readings: Record<string, { totalizer: string; rtt: string; photo?: string }>;
  collections: { cash: string; momo: string; pos: string; corporate: string };
  step: number;
}

const DRAFT_KEY = 'donggas_shift_draft';

export default function ShiftCloseWizard({ 
  shiftId, 
  pumps, 
  onComplete 
}: { 
  shiftId: string; 
  pumps: Pump[]; 
  onComplete: () => void;
}) {
  const [step, setStep] = useState(1);
  const [readings, setReadings] = useState<Record<string, { totalizer: string; rtt: string; photo?: string }>>({});
  const [collections, setCollections] = useState({ cash: '', momo: '', pos: '', corporate: '' });
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<{ expected: number; actual: number; variance: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [currentPumpId, setCurrentPumpId] = useState<string | null>(null);

  // Auto-save draft every change
  useEffect(() => {
    const draft: Draft = { shiftId, readings, collections, step };
    localforage.setItem(DRAFT_KEY, draft);
  }, [readings, collections, step, shiftId]);

  // Restore draft on mount
  useEffect(() => {
    localforage.getItem<Draft>(DRAFT_KEY).then((draft) => {
      if (draft && draft.shiftId === shiftId) {
        setReadings(draft.readings || {});
        setCollections(draft.collections || { cash: '', momo: '', pos: '', corporate: '' });
        setStep(draft.step || 1);
      }
    });
  }, [shiftId]);

  const startCamera = async (pumpId: string) => {
    setCurrentPumpId(pumpId);
    setCameraActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' }, 
        audio: false 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (e) {
      alert('Camera access denied. Please allow camera for photo proof.');
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current || !currentPumpId) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);

    // Stop camera
    const stream = video.srcObject as MediaStream;
    stream?.getTracks().forEach(t => t.stop());
    setCameraActive(false);

    setReadings(prev => ({
      ...prev,
      [currentPumpId]: { ...prev[currentPumpId], photo: dataUrl }
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      // In production: upload photos to Supabase Storage first, get public URLs
      // For demo we send base64 (or replace with upload logic)
      const payload = {
        shift_id: shiftId,
        closed_by: 'Supervisor - Accra East',
        pump_readings: pumps.map(p => ({
          pump_id: p.id,
          totalizer_reading: Number(readings[p.id]?.totalizer || 0),
          rtt_liters: Number(readings[p.id]?.rtt || 0),
          photo_url: readings[p.id]?.photo || null, // replace with real URL after upload
        })),
        collections: {
          cash: Number(collections.cash || 0),
          momo: Number(collections.momo || 0),
          pos: Number(collections.pos || 0),
          corporate: Number(collections.corporate || 0),
        },
      };

      const res = await fetch('/api/shifts/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');

      await localforage.removeItem(DRAFT_KEY);
      setPreview({ expected: data.expected_ghs, actual: data.actual_ghs, variance: data.variance_ghs });
      onComplete();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold text-amber-400 mb-2">Dong Gas — Shift Close</h1>
      <p className="text-slate-400 text-sm mb-6">Step {step} of 4 • Offline-safe</p>

      {/* STEP 1: Meter Readings */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">1. Closing Totalizer Readings</h2>
          {pumps.map(p => (
            <div key={p.id} className="bg-slate-800 rounded-xl p-4">
              <div className="font-medium">{p.nozzle_label} ({p.fuel_grade})</div>
              <input
                type="number"
                step="0.001"
                placeholder="Closing totalizer (liters)"
                className="w-full mt-2 p-3 rounded-lg bg-slate-700 text-white text-lg"
                value={readings[p.id]?.totalizer || ''}
                onChange={e => setReadings(prev => ({
                  ...prev,
                  [p.id]: { ...prev[p.id], totalizer: e.target.value, rtt: prev[p.id]?.rtt || '0' }
                }))}
              />
              <input
                type="number"
                step="0.001"
                placeholder="RTT test liters (usually 0)"
                className="w-full mt-2 p-3 rounded-lg bg-slate-700 text-white"
                value={readings[p.id]?.rtt || ''}
                onChange={e => setReadings(prev => ({
                  ...prev,
                  [p.id]: { ...prev[p.id], rtt: e.target.value, totalizer: prev[p.id]?.totalizer || '' }
                }))}
              />
            </div>
          ))}
          <button
            onClick={() => setStep(2)}
            className="w-full py-4 bg-amber-500 text-black font-bold rounded-xl text-lg"
          >
            Next → Photo Proof
          </button>
        </div>
      )}

      {/* STEP 2: Photo Capture */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">2. Photo Proof (Mandatory)</h2>
          <p className="text-sm text-slate-400">Snap the mechanical/digital totalizer clearly.</p>
          {pumps.map(p => (
            <div key={p.id} className="bg-slate-800 rounded-xl p-4">
              <div className="font-medium mb-2">{p.nozzle_label}</div>
              {readings[p.id]?.photo ? (
                <img src={readings[p.id].photo} alt="Proof" className="w-full rounded-lg mb-2" />
              ) : (
                <button
                  onClick={() => startCamera(p.id)}
                  className="w-full py-3 bg-slate-700 rounded-lg"
                >
                  📷 Capture Totalizer Photo
                </button>
              )}
            </div>
          ))}

          {cameraActive && (
            <div className="fixed inset-0 bg-black z-50 flex flex-col">
              <video ref={videoRef} autoPlay playsInline className="flex-1 object-cover" />
              <canvas ref={canvasRef} className="hidden" />
              <button
                onClick={capturePhoto}
                className="m-4 py-4 bg-amber-500 text-black font-bold rounded-xl"
              >
                Capture Photo
              </button>
            </div>
          )}

          <button
            onClick={() => setStep(3)}
            disabled={pumps.some(p => !readings[p.id]?.photo)}
            className="w-full py-4 bg-amber-500 text-black font-bold rounded-xl text-lg disabled:opacity-50"
          >
            Next → Collections
          </button>
        </div>
      )}

      {/* STEP 3: Cash / MoMo Counter */}
      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">3. Collections (GHS)</h2>
          {[
            { key: 'cash', label: 'Physical Cash' },
            { key: 'momo', label: 'MTN MoMo + Telecel Cash' },
            { key: 'pos', label: 'POS / Card' },
            { key: 'corporate', label: 'Corporate LPO / Credit' },
          ].map(item => (
            <div key={item.key}>
              <label className="text-sm text-slate-400">{item.label}</label>
              <input
                type="number"
                step="0.01"
                className="w-full p-3 rounded-lg bg-slate-700 text-white text-xl font-mono"
                value={(collections as any)[item.key]}
                onChange={e => setCollections(prev => ({ ...prev, [item.key]: e.target.value }))}
              />
            </div>
          ))}
          <button
            onClick={() => setStep(4)}
            className="w-full py-4 bg-amber-500 text-black font-bold rounded-xl text-lg"
          >
            Next → Review & Submit
          </button>
        </div>
      )}

      {/* STEP 4: Review */}
      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">4. Review & Close Shift</h2>
          <div className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
            {pumps.map(p => (
              <div key={p.id}>
                {p.nozzle_label}: {readings[p.id]?.totalizer || '—'} L
                {readings[p.id]?.photo && ' 📷'}
              </div>
            ))}
            <hr className="border-slate-600" />
            <div>Cash: GH₵{collections.cash || 0}</div>
            <div>MoMo: GH₵{collections.momo || 0}</div>
            <div>POS: GH₵{collections.pos || 0}</div>
            <div>Credit: GH₵{collections.corporate || 0}</div>
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-4 bg-green-500 text-black font-bold rounded-xl text-lg"
          >
            {loading ? 'Closing…' : 'Submit & Notify Owner'}
          </button>
          {preview && (
            <div className={`p-4 rounded-xl ${preview.variance > 20 ? 'bg-red-900' : 'bg-green-900'}`}>
              Expected: GH₵{preview.expected.toFixed(2)}<br />
              Actual: GH₵{preview.actual.toFixed(2)}<br />
              Variance: GH₵{preview.variance.toFixed(2)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}