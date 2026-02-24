import { Routes, Route } from "react-router";
import { Layout } from "@/components/Layout";
import { Home } from "@/pages/Home";
import { Features } from "@/pages/Features";
import { Docs } from "@/pages/Docs";
import { About } from "@/pages/About";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/features" element={<Features />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/about" element={<About />} />
      </Routes>
    </Layout>
  );
}
