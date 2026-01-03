import "./globals.css";

export const metadata = {
  title: "Ordem",
  description: "Imperium Ordem Mini App"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
