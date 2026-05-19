# Pushing the Frontier for Data Agents with Genie

**By The Databricks AI Research Team**

Genie is Databricks’ state-of-the-art data agent designed for answering complex questions about enterprise data consisting of both structured (tables, dashboards, notebooks, etc.) and unstructured (workspace files, Google Drive, Sharepoint etc.) data sources. This blog describes some of the unique challenges faced by data agents and introduces techniques to address them, including using specialized knowledge search, parallel thinking, and Multi-LLM designs. From our experiments on an internal benchmark of real-world data analysis tasks, we observe that these techniques can significantly improve the overall accuracy of Genie over a leading coding agent (from 32% to over 90%) while also significantly reducing the costs and latency.

## Key Challenges for Data Agents
Coding agents have shown that a powerful LLM can do incredible things autonomously when equipped with tools that help it understand the code context. While coding agents operate effectively in static, deterministic environments like a disk's file system, data agents introduce an entirely new paradigm. Data agents work within a dynamic, constantly evolving data lakehouse that encompasses a wealth of semantic context across hundreds of thousands of tables, notebooks, dashboards, and documents.

For example, consider a real (anonymized) query asked by an internal user in Figure 2: the user notices that two enterprise dashboards reporting the same product's revenue show contradictory spikes on different dates and asks the agent to explain why. This reasonable question is deceptively hard because no single data source contains the answer and resolving the question requires cross-system discovery across tables, internal documents, and dashboards, and reasoning about how multi-day reports are set up. Additionally, it requires the agent to dig into enterprise pricing details to find contract rates. Finally, it requires the agent to have an ability to automatically correct itself when intermediate calculations reveal incorrect initial assumptions. The figure shows how the agent is able to successfully solve the task by proceeding in different phases: (1) parallel multi-agent data discovery, (2) data investigation, (3) self-correction loop, and (4) verification.

> **Figure 2 Description: An Example Trajectory**
> This is a sequential diagram illustrating the 6 phases Genie navigates to resolve a complex user query where two separate dashboards showed conflicting revenue metrics:
> * **Phase 1: Parallel Discovery**: Two sub-agents map out the landscape in parallel. One reads the SQL behind the dashboards, while the other maps tables across schemas.
> * **Phase 2: SQL Extraction**: Parallel tracks of queries are run. One track counts raw invocations (volume), while the other tracks dollar revenue, catching an early mismatch in definitions.
> * **Phase 3: Comparative Analysis**: The system maps interconnected nodes, identifying a massive invocation spike on a single day, contrasted with a much smaller revenue spike. This points to a pricing discrepancy rather than a data bug.
> * **Phase 4: Root-Cause Investigation**: The agent branches out into document searches, retrieving a Cost-Attribution document that reveals a negotiated credit plus a discount explains the divergence.
> * **Phase 5: Reconciliation**: A waterfall chart demonstrates how gross revenue reconciles to net revenue after billable, list price, discounts, and credits are applied. Both dashboards were actually correct!
> * **Phase 6: Per-Customer Verification**: A final check validates the mathematical formula, closing the gap perfectly to the dollar.

Compared to Coding Agents, Data Agents have three key unique challenges:
- **Scale of Data Discovery**: Finding the right data sources to answer the user query is one of the biggest challenges with enterprise customers having millions of structured and unstructured sources (like tables, dashboards, and documents), a scale that breaks conventional search methods.
- **Determining "Source of Truth" Business Knowledge**: Answering business questions needs deep, specific knowledge drawn from many sources (e.g., table metadata, company documents, internal messages) that are often outdated, contradictory, or superseded, forcing the agent to determine the most authoritative information.
- **Lack of Verifiable Tests**: Unlike coding agents that can use deterministic, verifiable tests to iteratively refine code, data agents have no corresponding test because the "specification" is just the high-level user query without a notion of the expected correct answer. Moreover, the queries may not always be answerable because of incompleteness in data, and it is important for data agents to be able to identify such cases and surface it back to users.

## Key Technical Advances
Figure 3 shows some of the key technical innovations in Genie that enable it to perform significantly better than generic coding agents, namely: i) Specialized Knowledge Search, ii) Parallel Thinking, and iii) Multi-LLM. Specialized knowledge search uses semantic contextual data to ground the asset discovery sub-agents and significantly improve the search quality. Parallel thinking allows the agent to sample multiple different trajectories and then aggregate the findings across trajectories to compute the final answer. Finally, Multi-LLM allows the agent to use different LLMs for each of the different sub-agents together with their optimized prompts to further improve the overall accuracy and latency.

> **Figure 3 Description: Key Technical Advances in Genie**
> This diagram shows the system architecture, with three main modules integrated into a unified flow from a "User Query" to an "Answer":
> 1. **Specialized Knowledge Search**: An enterprise context index scans data assets (tables, notebooks, dashboards, documents) to retrieve relevant metadata.
> 2. **Parallel Thinking**: 8 parallel reasoning paths (sub-agents) execute queries, which are then funneled through a "JUDGE • AGGREGATE" layer to consolidate the reasoning trajectory.
> 3. **Multi-LLM**: Illustrates how specialized subtasks (plan, search, reason, judge) are routed to distinct LLMs optimized specifically for those roles.

## Specialized Knowledge Search
Genie uses the existing data assets such as workspace tables, notebooks, dashboards, documents, and files to derive a rich semantic enterprise context and then uses this context to construct a search index. It uses multiple search indices in parallel together with rich metadata signals to efficiently discover most relevant assets for a user query. Figure 4 demonstrates how leveraging the specialized knowledge search helps Genie improve table search performance by up to 40% on our table discovery benchmarks.

> **Figure 4 Description: Specialized Knowledge Search for Table Discovery**
> This line graph illustrates how semantic context improves table search:
> * **Metrics**: The Y-axis is Recall@10, and the X-axis is Max Steps (2, 4, 8, 16).
> * **Configurations**:
>   * **With Semantic Context** (Blue line): Starts at 0.450 (2 steps) and scales up to 0.774 (16 steps).
>   * **Without Semantic Context** (Green line): Starts much lower at 0.075 (2 steps) and only reaches 0.466 (16 steps).
> * **Key Takeaway**: Providing semantic context radically boosts table search performance, improving recall by roughly 30 to 40 percentage points across all step thresholds.

## Parallel Thinking
Unlike software engineering tasks, where coding agents can first write tests to verify the desired functionality and then iterate on code generation until the tests pass, the open-ended data queries don't have such corresponding unit tests. In the absence of tests, it becomes challenging for data agents to know if the generated answer is correct or needs more refinement. To address this challenge, we leverage parallel thinking by sampling multiple trajectories and aggregating relevant information across the trajectories to compute the final answer. Figure 5 shows how parallel thinking can significantly improve the answer accuracy, although with some additional latency and token costs. Furthermore, as shown in Figure 1, combining Multi-LLM and further optimizations can further significantly reduce costs and latency.

> **Figure 5 Description: Parallel-Thinking: Impact on GPT-5.4 and Opus-4.6**
> This double Y-axis bar chart compares accuracy vs. runtime when parallel thinking is introduced:
> * **Metrics**: The left Y-axis (solid colored columns) represents Accuracy (%), and the right Y-axis (diagonal-striped columns) represents Average Runtime in minutes.
> * **Performance**:
>   1. **Baseline (GPT-5.4)**: 65.5% accuracy, 3.8m runtime.
>   2. **Baseline (All Opus-4.6)**: 73.8% accuracy, 5.5m runtime.
>   3. **Parallel-Thinking (All GPT-5.4)**: 75.7% accuracy (up 10.2 percentage points), 8.2m runtime.
>   4. **Parallel-Thinking (All Opus-4.6)**: 81.4% accuracy (up 7.6 percentage points), 9.5m runtime.
> * **Key Takeaway**: Parallel Thinking consistently yields strong accuracy gains (7.6 to 10.2 percentage points), though it roughly doubles the average runtime.
>
> **Figure 1 Description: Optimizing Genie with Specialized Knowledge Search, Parallel Thinking, and Multi-LLM**
> This is a combined bar and line chart showing the trade-off between accuracy and cost for different agent configurations:
> * **Metrics**: The left Y-axis shows Accuracy (%) from 0% to 100% (represented by orange vertical bars), and the right Y-axis shows Relative Cost from 0x to 3x (represented by a black line with circular data points).
> * **Configurations Evaluated**:
>   1. **Leading Code Agent + Databricks MCP**: The baseline, with an accuracy of **32.1%** and a relative cost of **1.00x**.
>   2. **Genie with Specialized Knowledge Search (Opus 4.6)**: Accuracy jumps to **73.8%**, while the relative cost significantly drops to **0.23x**.
>   3. **+ Parallel Thinking (N=8, Opus 4.6)**: Accuracy rises further to **81.4%**, but the relative cost climbs sharply to **2.13x**.
>   4. **+ Multi-LLM (GPT-5.4 + Opus 4.6)**: Accuracy peaks at **91.6%**, and the relative cost falls back down to a highly optimized **0.95x**.
> * **Key Takeaway**: By sequentially adding these techniques, accuracy increases dramatically from 32.1% to 91.6%. The final Multi-LLM design achieves the highest accuracy while keeping the cost slightly below the original single-agent baseline.

## Multi-LLM
One of the key technical advances in Genie is the ability to leverage different LLMs for different sub-agents as we observe different LLMs are good at complementary capabilities. For example, it can use a different LLM for the planning stage, a different LLM for various search sub-agents, a different one for code generation and judges. With the Databricks platform, it is seamless to try out any of the frontier models (including Opus, GPT, and Gemini), open-source models, as well as custom trained models. In addition to accuracy, we also observe that different LLMs result in very different latency and cost characteristics. Figure 6 shows how different LLMs perform on table search tasks and how the corresponding accuracy and cost can be further optimized using methods like GEPA.

> **Figure 6 Description: Optimizing Accuracy and Cost for Different LLMs using GEPA**
> This scatter plot with vector trajectories shows how prompt optimization improves various LLMs:
> * **Metrics**: The Y-axis represents End-to-End Accuracy (%), and the X-axis represents Relative Token Cost (with Sonnet 4.5 baseline set at 1.0).
> * **Model Transitions**:
>   * **Sonnet 4.5**: Baseline (73.0% acc, 1.0 cost) shifts to Optimized (78.2% acc, ~0.8 cost).
>   * **GPT 5.4**: Baseline (~71.8% acc, ~0.76 cost) shifts to Optimized (78.2% acc, ~0.74 cost).
>   * **GPT 5.4-mini**: Baseline (~75.3% acc, ~0.71 cost) shifts to Optimized (76.9% acc, ~0.66 cost).
>   * **Opus 4.6**: Baseline (~66.5% acc, ~0.98 cost) shifts to Optimized (74.4% acc, ~0.90 cost).
> * **Key Takeaway**: Using GEPA (Generative Engine Prompt Optimization) successfully shifts all evaluated LLMs into the "high-accuracy, low-cost" quadrant (moving up and left on the chart), achieving better performance while using fewer tokens.

## Conclusion
While coding and data analysis share many conceptual similarities, the dynamic nature of enterprise data systems create some unique challenges. Data agents need to efficiently discover the right assets from a large enterprise context, determine “truth” in an ambiguous environment and write efficient code and queries to correctly answer user's questions. We developed several novel approaches to solve these problems such as specialized knowledge search to leverage rich semantic information and multiple metadata signals, Multi-LLM to leverage different LLMs with optimized prompts using GEPA, and parallel thinking to further improve the overall accuracy. Adding these approaches to Genie helps it perform significantly better than leading coding agents on the benchmark tasks. There are still a lot of challenging open-ended questions left to explore, and it has never been a more exciting time to explore research in this area of building state-of-the-art data agents for enterprises.
