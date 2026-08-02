/** GLB models are served as build-time-resolved asset URLs via the webpack rule in next.config.js. */
declare module "*.glb" {
  const src: string;
  export default src;
}
