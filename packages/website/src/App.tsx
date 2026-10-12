import { Routes, Route } from "react-router";
import { Layout } from "@/components/Layout";
import { NotFound } from "@/pages/NotFound";
import { routes } from "@/routes";

export function App() {
  return (
    <Layout>
      <Routes>
        {routes.map((r) => (
          <Route key={r.path} path={r.path} element={r.element} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
