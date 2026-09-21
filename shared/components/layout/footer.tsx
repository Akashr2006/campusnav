import Link from "next/link";
import { Compass, Github, Twitter, Linkedin } from "lucide-react";

const cols = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Home" },
      { href: "/navigate", label: "Navigator" },
      { href: "/admin", label: "Admin" },
    ],
  },

  {
    title: "Company",
    links: [
      { href: "#", label: "About" },
      { href: "#", label: "Careers" },
      { href: "#", label: "Blog" },
      { href: "#", label: "Contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "#", label: "Docs" },
      { href: "#", label: "API" },
      { href: "#", label: "Status" },
      { href: "#", label: "Changelog" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "#", label: "Privacy" },
      { href: "#", label: "Terms" },
      { href: "#", label: "Security" },
      { href: "#", label: "Cookies" },
    ],
  },
];

export function Footer() {
  return null;
}
