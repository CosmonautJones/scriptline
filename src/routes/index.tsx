import { createFileRoute } from "@tanstack/react-router";
import { Extractor } from "@/components/extractor";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <Extractor />;
}
