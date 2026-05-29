const TOKEN_KEY = "token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export async function login(username: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  const data = await res.json();
  localStorage.setItem(TOKEN_KEY, data.token);
  return data;
}

export async function getEvents() {
  return (await fetch("/api/events")).json();
}

export async function getEvent(id: number) {
  return (await fetch(`/api/events/${id}`)).json();
}

export async function createOrder(zoneId: number, quantity: number) {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: getToken() },
    body: JSON.stringify({ zoneId, quantity }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function payOrder(orderId: number) {
  const res = await fetch(`/api/orders/${orderId}/pay`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: getToken() },
    body: JSON.stringify({ outcome: "success" }),
  });
  return res.json();
}
