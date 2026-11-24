import ui from "./ui";
import tasks from "./tasks";
import settings from "./settings";
import misc from "./misc";

const AR: Record<string, string> = { ...ui, ...tasks, ...settings, ...misc };
export default AR;
