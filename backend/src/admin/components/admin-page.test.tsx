import { renderToStaticMarkup } from "react-dom/server";

import {
  AdminPageHeader,
  AdminSingleColumnLayout,
} from "./admin-page";

describe("AdminPageHeader", () => {
  it("renders one route heading with its description, status, and actions", () => {
    const markup = renderToStaticMarkup(
      <AdminPageHeader
        actions={<button type="button">Create post</button>}
        description="Draft, schedule, and publish label news."
        status={<span>Operational</span>}
        title="News"
      />,
    );

    expect(markup).toContain("<h1");
    expect(markup).toContain(">News</h1>");
    expect(markup).toContain("Draft, schedule, and publish label news.");
    expect(markup).toContain("Operational");
    expect(markup).toContain("Create post");
  });
});

describe("AdminSingleColumnLayout", () => {
  it("preserves route state attributes and a caller class", () => {
    const markup = renderToStaticMarkup(
      <AdminSingleColumnLayout aria-busy className="audit-route">
        <section>Content</section>
      </AdminSingleColumnLayout>,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("audit-route");
    expect(markup).toContain("flex flex-col gap-y-3");
  });
});
