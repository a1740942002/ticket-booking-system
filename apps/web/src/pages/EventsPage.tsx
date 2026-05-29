import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getEvents } from "@/lib/api";
import { Card } from "@/components/ui/card";

export function EventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  useEffect(() => { getEvents().then(setEvents); }, []);
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">演唱會列表</h1>
      {events.map((e) => (
        <Link key={e.id} to={`/events/${e.id}`}>
          <Card className="p-4 hover:bg-accent">
            <div className="font-semibold">{e.title}</div>
            <div className="text-sm text-muted-foreground">{e.venue}</div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
