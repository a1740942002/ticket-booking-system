import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getEvent, createOrder, login, getToken } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState<any>(null);
  const [username, setUsername] = useState("");

  useEffect(() => { getEvent(Number(id)).then(setEvent); }, [id]);
  if (!event) return <div className="p-6">載入中...</div>;

  async function buy(zoneId: number) {
    if (!getToken()) {
      if (!username) return alert("請先輸入使用者名稱");
      await login(username);
    }
    try {
      const order = await createOrder(zoneId, 1);
      navigate(`/orders/${order.id}`);
    } catch (e: any) {
      alert("下單失敗:" + e.message);
    }
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">{event.title}</h1>
      <div className="text-muted-foreground">{event.venue}</div>
      <Input placeholder="使用者名稱" value={username}
        onChange={(e) => setUsername(e.target.value)} />
      {event.zones.map((z: any) => (
        <Card key={z.id} className="p-4 flex justify-between items-center">
          <div>
            <div className="font-semibold">{z.name}</div>
            <div className="text-sm">NT${z.price} ・ 剩 {z.availableQuantity}</div>
          </div>
          <Button disabled={z.availableQuantity < 1} onClick={() => buy(z.id)}>
            搶票
          </Button>
        </Card>
      ))}
    </div>
  );
}
