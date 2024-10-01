import { App, Editor, TFile } from "obsidian";
import { SearchResult } from "./search-result";
import { isBlank } from "../util/utils";

const NEW_LINE_REGEX = /\r?\n|\r|\n/g;

interface SearchOperationResult {
    searchResults: SearchResult[];
    numberOfFilesWithMatches: number;
}

export interface ReplaceOperationResult {
    lineSearchResults: SearchResult[];
    filePath: string;
    lineNumber: number;
}

const EMPTY_SEARCH_OPERATION_RESULT = {
    numberOfFilesWithMatches: 0,
    searchResults: [],
};

export class FileOperator {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    public async search(
        query: string,
        regexEnabled: boolean,
        caseSensitivityEnabled: boolean,
        ignoreProperties: boolean // Add this parameter
    ): Promise<SearchOperationResult> {
        if (isBlank(query)) {
            return EMPTY_SEARCH_OPERATION_RESULT;
        }

        const queryRegex = this.createQueryRegex(query, regexEnabled, caseSensitivityEnabled);
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const searchResults: SearchResult[] = [];

        let numberOfFilesWithMatches = 0;

        for (const file of markdownFiles) {
            const contents = await this.app.vault.read(file);
            
            // Handle the ignoring of the front matter if the setting is enabled
            let contentToSearch = contents;
            if (ignoreProperties) {
                contentToSearch = this.removeFrontMatter(contentToSearch);
            }

            const lines = this.splitIntoLines(contentToSearch);
            let foundAMatchInCurrentFile = false;

            lines.forEach((line, i) => {
                const intermediateResults: SearchResult[] = this.searchInLine(
                    line,
                    i + 1,
                    file,
                    queryRegex
                );

                if (intermediateResults.length !== 0) {
                    foundAMatchInCurrentFile = true;
                }

                searchResults.push(...intermediateResults);
            });

            if (foundAMatchInCurrentFile) {
                numberOfFilesWithMatches++;
                foundAMatchInCurrentFile = false;
            }
        }

        return { searchResults, numberOfFilesWithMatches };
    }

    public async replace(
        searchResult: SearchResult,
        replacementText: string,
        query: string,
        regexEnabled: boolean,
        caseSensitivityEnabled: boolean,
        ignoreProperties: boolean // Add this parameter
    ): Promise<ReplaceOperationResult | undefined> {
        const file = searchResult.file;
        if (!file) return;

        const contents = await this.app.vault.read(file);
        let contentToReplace = contents;

        // Ignore front matter if the setting is enabled
        if (ignoreProperties) {
            contentToReplace = this.removeFrontMatter(contentToReplace);
        }

        await this.app.workspace.openLinkText(searchResult.filePath, "");
        const activeEditor = this.app.workspace.activeEditor;

        const editingTheCorrectFile = activeEditor?.file === file;
        if (!editingTheCorrectFile) return;

        const editor: Editor | undefined = activeEditor?.editor;
        if (!editor) return;

        editor.setSelection(
            {
                line: searchResult.lineNumber - 1,
                ch: searchResult.matchStartIndex,
            },
            {
                line: searchResult.lineNumber - 1,
                ch: searchResult.matchEndIndex + 1,
            }
        );

        const queryRegex = this.createQueryRegex(query, regexEnabled, caseSensitivityEnabled);

        // Replace the selection with replacementText
        if (regexEnabled) {
            editor.replaceSelection(editor.getSelection().replaceAll(queryRegex, replacementText));
        } else {
            editor.replaceSelection(replacementText);
        }

        // Force flush of editor change to prevent race condition
        await this.app.vault.modify(file, editor.getValue());

        const lineSearchResults = this.searchInLine(
            editor.getLine(searchResult.lineNumber - 1),
            searchResult.lineNumber,
            file,
            queryRegex
        );

        return {
            lineSearchResults: lineSearchResults,
            filePath: file.path,
            lineNumber: searchResult.lineNumber,
        };
    }

    // Utility method to remove the front matter
    private removeFrontMatter(contents: string): string {
        const frontMatterRegex = /^---[\s\S]*?---\n/g;
        return contents.replace(frontMatterRegex, "");
    }

    private createQueryRegex(
        query: string,
        regexEnabled: boolean,
        caseSensitivityEnabled: boolean
    ) {
        let flags = "g";
        if (!caseSensitivityEnabled) {
            flags += "i";
        }
        query = regexEnabled ? query : this.escapeRegexString(query);
        return new RegExp(query, flags);
    }

    private searchInLine(
        line: string,
        lineNumber: number,
        file: TFile,
        queryRegex: RegExp
    ): SearchResult[] {
        const matches = line.matchAll(queryRegex);

        return [...matches].map((match: RegExpMatchArray) => {
            if (match.index === undefined)
                throw new Error("Regex match index was undefined. This should never happen.");

            return new SearchResult(
                line,
                lineNumber,
                file.path,
                match.index,
                match.index + match[0].length - 1,
                file
            );
        });
    }

    private splitIntoLines(contents: string) {
        return contents.split(NEW_LINE_REGEX);
    }

    private escapeRegexString(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
}
