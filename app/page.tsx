"use client";
import { useEffect } from "react";
export default function Home() {
  useEffect(() => {
    window.location.replace("/digitlab.html" + window.location.search + window.location.hash);
  }, []);
  return <main style={{minHeight:"100vh",background:"#091017",color:"#e6edf2",padding:24,fontFamily:"system-ui"}}>Opening DigitLab Predictor…</main>;
}
