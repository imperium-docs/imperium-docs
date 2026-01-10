import "./admin.css";

export const metadata = {
  title: "Imperium Admin",
  description: "Imperium analytics and governance dashboard."
};

export default function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return <section className="admin-root">{children}</section>;
}
