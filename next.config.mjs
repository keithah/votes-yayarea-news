/** @type {import('next').NextConfig} */
const isGithubPages = process.env.GITHUB_PAGES === 'true';
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'votes-yayarea-news';
const githubPagesBasePath = `/${repositoryName}`;

const nextConfig = {
  output: 'export',
  trailingSlash: true,
  ...(isGithubPages
    ? {
        basePath: githubPagesBasePath,
      }
    : {}),
};

export default nextConfig;
