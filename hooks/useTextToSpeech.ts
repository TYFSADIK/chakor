'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`[^`]+`/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/^[-*+]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/^>\s/gm, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim();
}

export interface TextToSpeechState {
  speak: (text: string, msgId?: string) => void;
  stop: () => void;
  speaking: boolean;
  speakingId: string | null;
  supported: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoice: SpeechSynthesisVoice | null;
  setSelectedVoice: (v: SpeechSynthesisVoice | null) => void;
  rate: number;
  setRate: (r: number) => void;
}

export function useTextToSpeech(): TextToSpeechState {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoiceState] = useState<SpeechSynthesisVoice | null>(null);
  const [rate, setRateState] = useState(1.0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    setSupported(true);

    const savedRate = parseFloat(localStorage.getItem('chakor-tts-rate') ?? '1.0');
    if (!isNaN(savedRate)) setRateState(savedRate);

    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      const savedVoiceName = localStorage.getItem('chakor-tts-voice');
      if (savedVoiceName) {
        const found = v.find((x) => x.name === savedVoiceName);
        if (found) setSelectedVoiceState(found);
      }
    };

    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const stop = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (text: string, msgId?: string) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();

      const clean = stripMarkdown(text);
      if (!clean) return;

      const utterance = new SpeechSynthesisUtterance(clean);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.rate = rate;

      utterance.onstart = () => { setSpeaking(true); setSpeakingId(msgId ?? null); };
      utterance.onend = () => { setSpeaking(false); setSpeakingId(null); };
      utterance.onerror = () => { setSpeaking(false); setSpeakingId(null); };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [selectedVoice, rate],
  );

  const setSelectedVoice = useCallback((v: SpeechSynthesisVoice | null) => {
    setSelectedVoiceState(v);
    localStorage.setItem('chakor-tts-voice', v?.name ?? '');
  }, []);

  const setRate = useCallback((r: number) => {
    setRateState(r);
    localStorage.setItem('chakor-tts-rate', String(r));
  }, []);

  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  return { speak, stop, speaking, speakingId, supported, voices, selectedVoice, setSelectedVoice, rate, setRate };
}
