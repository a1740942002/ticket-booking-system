import { BrowserRouter, Routes, Route } from "react-router-dom";
import { EventsPage } from "@/pages/EventsPage";
import { EventDetailPage } from "@/pages/EventDetailPage";
import { OrderPage } from "@/pages/OrderPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EventsPage />} />
        <Route path="/events/:id" element={<EventDetailPage />} />
        <Route path="/orders/:id" element={<OrderPage />} />
      </Routes>
    </BrowserRouter>
  );
}
