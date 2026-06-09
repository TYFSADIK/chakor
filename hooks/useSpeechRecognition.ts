'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export interface SpeechRecognitionState {
  listening: boolean;
  transcript: string;
  interimTranscript: string;
  supported: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeechRecognition(lang?: string): SpeechRecognitionState {
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [supported, setSupported] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const finalRef = useRef('');

  useEffect(() => {
    const SR = (typeof window !== 'undefined')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
      : null;
    setSupported(!!SR);
  }, []);

  const start = useCallback(() => {
    if (typeof window === 'undefined') return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) return;

    finalRef.current = '';
    setTranscript('');
    setInterimTranscript('');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new SR() as any;
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang ?? navigator.language ?? 'en-US';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let interim = '';
      let final = finalRef.current;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }
      finalRef.current = final;
      setTranscript(final);
      setInterimTranscript(interim);
    };

    rec.onend = () => {
      setListening(false);
      setInterimTranscript('');
    };

    rec.onerror = () => {
      setListening(false);
      setInterimTranscript('');
    };

    rec.start();
    recRef.current = rec;
    setListening(true);
  }, [lang]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
    setInterimTranscript('');
  }, []);

  const reset = useCallback(() => {
    finalRef.current = '';
    setTranscript('');
    setInterimTranscript('');
  }, []);

  useEffect(() => {
    return () => { recRef.current?.stop(); };
  }, []);

  return { listening, transcript, interimTranscript, supported, start, stop, reset };
}
