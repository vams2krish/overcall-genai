import { notFound } from "next/navigation";
import { WebRTCProbe } from "@/components/qa/webrtc-probe";
export default function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <WebRTCProbe />;
}
