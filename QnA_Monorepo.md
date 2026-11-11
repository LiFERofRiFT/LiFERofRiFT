# Q&amp;A- Monorepo & Package Management

This document provides clarity on the repository structure, monorepo management, and how it integrates with package registries like GitHub Packages.

<details>
<summary>About monorepo structure</summary>

### 📂 Repository Structure Overview
The repository is organized into three distinct types of areas:
*   **`projects/`**: Ongoing active developments (Production-grade apps).
*   **`packages/`**: Shared utilities, components, and helper modules (Reusable code).
*   **`playground/`**: Experimental prototypes and "what if" scenarios (Testing ground).

### ❓ Frequently Asked Questions

<details>
<summary>Q: Are these folders automatically categorized by GitHub?</summary>
**A:** No. GitHub treats all files as a standard directory structure. They are manually created as folders and  project files are placed within them to maintain this organization.
</details>

<details>
<summary>Q: How these directories are created on the GitHub UI?</summary>
**A:** Since there is no "Create Folder" button, account owner has created a new file with the folder name as part of the path (e.g., `projects/.gitkeep`). The `.gitkeep` file ensures that Git tracks the directory even if it is empty.
</details>

<details open>
<summary>Q: Do I have to clone everything every time I want to work on one specific package?</summary>
**A:** By default, yes—Git clones the entire repository history and content. However, for large repositories, you can use **Sparse Checkout** to download only specific folders, or **Worktrees** to manage multiple active working directories simultaneously.
</details>

<details open>
<summary>Q: Does a monorepo structure make sense with GitHub Packages?</summary>
**A:** Yes! It is an industry-standard practice. 
*   The **Monorepo folder structure** is for *Development*: It allows you to share code and see changes instantly across different projects locally.
*   **GitHub Packages/Registries** are for *Distribution*: They allow other developers or machines to "install" your package as a dependency from the internet.
</details>

<details open>
<summary>Q: How to set up a package within an existing directory?</summary>
**A:**  To make a folder in `packages/` act as a distributable package, you must provide it with its own configuration file (like `package.json` for npm). You then use GitHub Actions to build that specific folder and "publish" it to the registry whenever changes are pushed.
</details>

</details>

---

### 📊 Summary Comparison Table

| Feature               | Monorepo Folders (`packages/`)                                          | GitHub Packages / Registry                        |
| :--------------------- | :----------------------------------------------------------------------- | :------------------------------------------------- |
| **Primary Goal**      | Organization &amp; Shared Development                                   | Distribution &amp; Dependency Management          |
| **How you access it** | `import { x } from '../packages/my-lib'` (relative path) or Workspaces. | `npm install @liferofrift/my-lib` (network fetch) |
| **Where code lives**  | In your local directory / Git Repo.                                     | On GitHub's servers as a "Published" version.     |
| **Who uses it?**      | Repository owner and other developers on the same repo.                 | Any developer who has access to the npm registry. |
