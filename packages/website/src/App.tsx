import { Routes, Route } from "react-router";
import { Layout } from "@/components/Layout";
import { Home } from "@/pages/Home";
import { Docs } from "@/pages/Docs";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/docs" element={<Docs />} />
      </Routes>
    </Layout>
  );
}
