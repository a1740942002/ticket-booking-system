import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { payOrder } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState<any>(null);

  async function refresh() {
    const res = await fetch(`/api/orders/${id}`);
    setOrder(await res.json());
  }
  useEffect(() => { refresh(); }, [id]);
  if (!order) return <div className="p-6">載入中...</div>;

  async function pay() {
    await payOrder(Number(id));
    refresh();
  }

  return (
    <div className="max-w-md mx-auto p-6 space-y-4">
      <Card className="p-6 space-y-2">
        <div>訂單 #{order.id}</div>
        <div>數量:{order.quantity}</div>
        <div>金額:NT${order.totalPrice}</div>
        <div>狀態:<span className="font-bold">{order.status}</span></div>
        {order.status === "pending_payment" && (
          <Button onClick={pay}>確認付款（mock）</Button>
        )}
        {order.status === "paid" && <div className="text-green-600">✅ 出票成功</div>}
      </Card>
    </div>
  );
}
